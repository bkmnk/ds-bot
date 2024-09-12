import {
  Message,
  MessageEmbed,
  PartialMessage,
  WebhookClient,
  WebhookMessageOptions,
} from "discord.js-selfbot-v13";
import puppeteer, { Browser, Page } from "puppeteer";
import * as fs from "fs";
import Enmap from "enmap";
import PQueue from "p-queue";
import { Promise as BluePromise } from "bluebird";

import { Config } from "./Config";
import { getChannel, logger, replacer } from "../functions";
import axios from "axios";
import { config } from "dotenv";

config();
const mavelyUserEmail = String(process.env.MAVELY_USER_EMAIL);
const mavelyUserPassword = String(process.env.MAVELY_USER_PASSWORD);

// Types
export type TMirrorSettings = {
  noContent: boolean;
  noEmbeds: boolean;
  noAttachments: boolean;
  replacers: {
    replace: string;
    with: string;
    where?: string;
  }[];
};

export type TMirrorProps = {
  webhook: string;
  channels: string[];
  settings: TMirrorSettings;
};

type TMirrorsProps = {
  mirrors: Enmap;
};

// Class
export class Mirror {
  private props: TMirrorProps;

  constructor(mirror: TMirrorProps) {
    this.props = mirror;
  }

  /**
   * @description Webhook Client
   **/
  get wh() {
    return new WebhookClient({ url: this.props.webhook });
  }

  get settings() {
    return this.props.settings;
  }
}

export class Mirrors {
  private props: TMirrorsProps;

  private mirroredMessages: {
    from: string;
    to: string;
    expire: number;
  }[] = [];
  private browser?: Browser = undefined;
  private page?: Page = undefined;
  private messageQueue: PQueue;
  private channels: Record<string, string> = {};
  private mavelyLinks: Record<string, string> = {};
  private hasLoggedIn = false;
  private processedItems = 0;

  private logErrors(methodname: string, error: Error) {
    const date = new Date().toISOString();
    console.log(`Error in method ${methodname}`, error);
    fs.appendFileSync(
      "errors.json",
      JSON.stringify({ methodname, error: error.message, date }, null, 2) +
      ",\n"
    );
  }
  constructor(config: Config) {
    this.initBrowser();


    console.log(`Carregando ${config.getMirrors().length} espelhos...`);
    this.props = {
      mirrors: new Enmap(),
    };

    config
      .getMirrors()
      .forEach((mirror) =>
        mirror.channels.forEach((channel) =>
          this.props.mirrors.set(channel, new Mirror(mirror))
        )
      );
    console.log(`  --> Espelhos carregados...\n`);

    this.messageQueue = new PQueue({ concurrency: 1 });

  }

  initBrowser = async () => {
    /* Set up browser */
    try {
      console.log('Starting browser')
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        env: {
          DISPLAY: ":10.0",
        },
        // timeout
      });
      const page = await browser.newPage();
      this.browser = browser;
      this.page = page;
      console.log('browser started');
      const generateLinkUrl = "https://creators.joinmavely.com/home";
      console.log('go to page');
      await page.goto(generateLinkUrl);
      console.log('went to page');
      await new Promise(async (resolve) =>
        setTimeout(() => resolve("done"), 2000)
      );
      console.log('starting login process', await page.$("input#email"))
      if (await page.$("input#email")) {
        console.log("🌐 Loggin in to Mavely");
        await page.type("#email", mavelyUserEmail);
        await page.type("#password", mavelyUserPassword);
        await page.click('button[type="submit"]');
        await page.waitForNavigation();
        await new Promise(async (resolve) =>
          setTimeout(() => resolve("done"), 3000)
        );
      }
      if (page.url() !== generateLinkUrl) {
        console.log("🌐 Login failed");
        await browser.close();
        return;
      }
      console.log("🌐 Logged in successfully to Mavely");
      return (this.hasLoggedIn = true);
    } catch (error) {
      this.logErrors("initBrowser", error as Error);
      return;
    }
  };

  generateMavelyLink = async (url: string) => {
    try {
      if (!this.browser || !this.page) {
        console.log("Browser not initialized");
        return null;
      }
      const page = this.page;
      await page.evaluate((url) => {
        const inputs = document.querySelectorAll("input#urlCompact");
        if (!inputs.length) {
          console.log("urlCompact input not found");
          return;
        }

        Array.from(inputs).map((input) => {
          (input as HTMLInputElement).value = url; // Set the value of the input(s)
        });
      }, url);

      await page.click('button[type="submit"]');
      await new Promise(async (resolve) =>
        setTimeout(() => resolve("done"), 5000)
      );
      const linkElement = await page.$("div.text-mblue");
      const link = linkElement
        ? await page.evaluate((el) => el.textContent, linkElement)
        : null;
      if (link) {
        page.evaluate(() => {
          const backButton = document.querySelector(
            ".bg-primary-50 > button:nth-child(2)"
          );
          if (!backButton) return;
          (backButton as HTMLButtonElement).click();
        });
      }
      // if(!link){
      //   await page.screenshot({
      //     path: "./sc-" + new Date().toISOString() + "-" + url + ".png",
      //   });
      // }
      return link;
    } catch (error) {
      this.logErrors("Mirrors.generateMavelyLink", error as Error);
      return null;
    }
  };

  parseUrl = async (url: string) => {
    try {
      const endUrl: string = await axios
        .get(url as string, {
          maxRedirects: 10,
          validateStatus: (status) => status >= 200 && status < 400,
          timeout: 15000,
        })
        .then((r) => r?.request?._currentUrl || r?.request?.res?.responseUrl)
        .catch((e) => e?.request?._currentUrl || e?.request?.res.responseUrl);

      const parsedEndUrl = (() => {
        try {
          return new URL(endUrl);
        } catch {
          return {
            origin: "",
            pathname: "",
          };
        }
      })();
      const endUrlClean = `${parsedEndUrl.origin}${parsedEndUrl.pathname}`;
      return { endUrl, endUrlClean };
    } catch (error) {
      this.logErrors("Mirrors.parseUrl", error as Error);
      return {
        endUrl: url,
        endUrlClean: url,
      };
    }
  };

  generateMavelyLinkForUrl = async (
    url: string,
    channelFrom: string
  ): Promise<string> => {
    try {
      const date = new Date().toISOString();

      // const { title, url } = embed;
      if (!url) {
        console.log("No url provided");
        return "";
      }
      const originalUrl = url || "";
      const SUPPORTED_URL_DOMAINS = ["mavely"];
      const supportedDomain = SUPPORTED_URL_DOMAINS.some((domain) =>
        originalUrl.includes(domain)
      );
      if (!supportedDomain) {
        console.log("Domain not supported: ", originalUrl);
        return originalUrl;
      }

      console.log("💫💫 Handling a message: ", url);

      const { endUrl, endUrlClean } = await this.parseUrl(originalUrl);
      let finalLink = await this.generateMavelyLink(endUrlClean);
      console.log('mavely link:', finalLink, 'for URL:', endUrlClean);
      if (!finalLink) {
        console.log("finalLink not found for: ", url, endUrlClean, finalLink);
        fs.appendFileSync(
          "./notGeneratedMavely.json",
          JSON.stringify({
            url,
            endUrlClean,
            endUrl,
            finalLink,
            date,
            channelFrom,
          }) + ',\n'
        );
        return originalUrl;
      }
      // finalLink = finalLink + '?'; // failsafe for urls added by mavely afterwards

      const relevantContent = {
        // title,
        channelFrom,
        url,
        endUrl,
        endUrlClean,
        finalLink,
        date,
      };
      fs.appendFileSync(
        "mavely.json",
        JSON.stringify(relevantContent, null, 2) + ",\n"
      );
      fs.appendFileSync(
        "mavely.csv",
        `${channelFrom}|${url}|${endUrl}|${endUrlClean}|${finalLink}|${date}\n`
      );

      console.log("💥💥 Final Mavely Link:", finalLink);
      return finalLink;
    } catch (error) {
      this.logErrors("Mirrors.generateMavelyLinkForUrl", error as Error);
      return "";
    }
  };

  discordMessageHandler = async (
    message: Message | PartialMessage,
    edited: Boolean = false,
    deleted: Boolean = false,
    channelFrom: string,
    mirror: Mirror,
    payload: WebhookMessageOptions
  ) => {
    try {
      if (deleted) {
        const findMessage = this.mirroredMessages.find(
          (msg) => msg.from === message.id
        );

        if (findMessage)
          mirror.wh
            .deleteMessage(findMessage.to)
            .then(() => logger(`${new Date().toISOString()} Mensagem deletada! De: ${channelFrom}`))
            .catch((err) => {
              logger(`${new Date().toISOString()} Error ao deletar mensagem! De: ${channelFrom}\n\n`, err);
            });
      } else if (edited) {
        const findMessage = this.mirroredMessages.find(
          (msg) => msg.from === message.id
        );

        if (findMessage)
          mirror.wh
            .editMessage(findMessage.to, payload)
            .then(() => logger(`${new Date().toISOString()} Mensagem editada! De: ${channelFrom}`))
            .catch((err) => {
              logger(`${new Date().toISOString()} Error ao editar mensagem! De: ${channelFrom}\n\n`, err);
            });
      } else {
        mirror.wh
          .send(payload)
          .then((msg) => {
            logger(`${new Date().toISOString()} Mensagem enviada! De: ${channelFrom}`);

            this.mirroredMessages.push({
              from: message.id,
              to: msg.id,
              expire: Date.now() + 24 * 60 * 60 * 1000, // 1 day
            });
          })
          .catch((err) => {
            logger(`${new Date().toISOString()} Erro ao enviar mensagem! De: ${channelFrom}\n\n`, err);
          });
      }
    } catch (error) {
      this.logErrors(`Mirrors.discordMessageHandler`, error as Error);
    }
  };

  handleUrlReplace = (message: Message | PartialMessage) => {
    // console.log("handling replace", this.mavelyLinks);
    message.embeds.forEach(async (embed) => {
      if (embed.url && this.mavelyLinks[embed.url]) {
        embed.url = this.mavelyLinks[embed.url];
      }
      if (embed.description) {
        const descriptionUrls =
          embed.description.match(/https?:\/\/[^\s]+/g) || [];
        let replacedDesc = 0;
        // console.log("descriptionUrls", descriptionUrls);
        descriptionUrls.forEach((url) => {
          if (this.mavelyLinks[url] && embed.description) {
            replacedDesc++;
            embed.description = embed.description.replace(
              url,
              this.mavelyLinks[url]
            );
          }
        });
        if (replacedDesc > 0) {
          embed.description = "🟠 " + embed.description;
        }
      }
    });
    if (message.content) {
      let replacedContent = 0;
      const contentUrls = message.content.match(/https?:\/\/[^\s]+/g) || [];
      // console.log("contentUrls", contentUrls);
      contentUrls.forEach((url) => {
        if (this.mavelyLinks[url] && message.content) {
          replacedContent++;
          console.log("replacing", url, "to:", this.mavelyLinks[url]);
          message.content = message.content.replace(url, this.mavelyLinks[url]);
        }
      });
      if (replacedContent > 0) {
        message.content = "🟠 " + message.content;
      }
    }
    return message;
  };

  onMirror = async (
    message: Message | PartialMessage,
    edited: Boolean = false,
    deleted: Boolean = false
  ) => {
    try {
      if (!this.messageQueue) {
        console.log("no messageQueue defined");
      }
      let channelFrom = this.channels[message.channelId];
      if (!channelFrom) {
        const getChannelResult = (await getChannel(message.channelId))?.name;
        this.channels[message.channelId] = getChannelResult;
        channelFrom = getChannelResult;
      }
      const channelId =
        message.channel?.isThread() &&
          message.channel?.parent?.type === "GUILD_FORUM"
          ? (message.channel?.parentId as string)
          : message.channelId;

      const mirror: Mirror | undefined = this.getMirror(channelId);
      if (!mirror) return;
      const date = new Date().toISOString();

      const payload = this.createPayload(message, mirror.settings);
      const replacedMessage = { ...message, ...payload };


      // if (!channelFrom.includes("oa-leads")) return;
      // console.log("Handling message from 💎┃oa-leads");
      fs.appendFileSync(
        "messages.json",
        JSON.stringify({ ...replacedMessage, date, channelFrom }, null, 2) +
        ",\n"
      );
      /* Get all links from the message */
      const messageLinks: string[] = [];
      replacedMessage.embeds.forEach(async (embed) => {
        if (embed.url) {
          messageLinks.push(embed?.url);
        }
        if (embed.description) {
          const descriptionUrls =
            embed.description.match(/https?:\/\/[^\s]+/g) || [];
          messageLinks.push(...descriptionUrls);
        }
      });
      if (replacedMessage.content) {
        const contentUrls =
          replacedMessage.content.match(/https?:\/\/[^\s]+/g) || [];
        messageLinks.push(...contentUrls);
      }

      /* Create mavely affiliate links for each URL */
      const mavellyLinks = messageLinks.filter((link) =>
        link.includes("mavely")
      );
      const uniqueLinks = [...new Set(mavellyLinks)];

      await BluePromise.each(uniqueLinks, async (url: string) => {
        await this.messageQueue.add(async () => {
          while (!this.hasLoggedIn) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          console.log("🔂 Adding message to the Queue", this.processedItems);
          try {
            console.log("🔂 Proccesing queue message...");
            const existentAffiliateLink = this.mavelyLinks[url];
            if (!existentAffiliateLink) {
              const generatedLink = await this.generateMavelyLinkForUrl(
                url,
                channelFrom
              );
              this.mavelyLinks[url] = generatedLink;
            }
            console.log("🔂 Message processed");
            this.processedItems++;
            return this.mavelyLinks[url] || url;
          } catch (queueError) {
            this.logErrors("onMirror - Queue Processing", queueError as Error);
          }
        });
      });

      /* Replace existent links for new affiliate ones */
      this.handleUrlReplace(message);
      this.handleUrlReplace(payload as unknown as Message);
      this.handleUrlReplace(replacedMessage as Message);
      // console.log(this.mavelyLinks);
      fs.writeFileSync("mavelyLinks.json", JSON.stringify(this.mavelyLinks));
      fs.appendFileSync(
        "updatedMessages.json",
        JSON.stringify({ ...replacedMessage, date, channelFrom }, null, 2) +
        ",\n"
      );
      fs.appendFileSync(
        "updatedMessagesOriginal.json",
        JSON.stringify({ ...message, date, channelFrom }, null, 2) +
        ",\n"
      );
      /* Send updated message to discord */
      await this.discordMessageHandler(
        message,
        edited,
        deleted,
        channelFrom,
        mirror,
        payload
      );
      fs.appendFileSync(
        "sentMessages.json",
        JSON.stringify(
          {
            title:
              message.embeds?.[0]?.title || message.embeds?.[0]?.description,
            date,
            channelFrom,
          },
          null,
          2
        ) + ",\n"
      );
      /* Clean up */
      if (this.processedItems > 10) {
        console.log(`Cleaning up ${Object.keys(this.mavelyLinks).length} links`);
        this.processedItems = 0;
        this.mavelyLinks = {}
      }
    } catch (error) {
      this.logErrors("onMirror", error as Error);
    }
  };

  private getMirror = (channel: string) => this.props.mirrors.get(channel);

  private createPayload = (
    message: Message | PartialMessage,
    mirrorSettings: TMirrorSettings
  ) => {
    const newMessage = replacer(message, mirrorSettings);

    const payload: WebhookMessageOptions = {
      threadName: newMessage?.channel?.isThread()
        ? newMessage?.channel?.name
        : undefined,
      content: !mirrorSettings.noContent
        ? newMessage.content
          ? newMessage.content
          : null
        : null,
      embeds: !mirrorSettings.noEmbeds
        ? newMessage.embeds.map(
          (embed) =>
          ({
            ...embed,
            fields: embed.fields.map((field) => ({
              name: field.name.trim().length === 0 ? "\u200B" : field.name,
              value:
                field.value.trim().length === 0 ? "\u200B" : field.value,
              inline: field.inline,
            })),
          } as MessageEmbed)
        )
        : [],
      files: !mirrorSettings.noAttachments
        ? [...newMessage.attachments.values()]
        : [],
    };
    return payload;
  };
}
