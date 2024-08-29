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
    this.messageQueue = new PQueue({ concurrency: 1 });

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
  }

  initBrowser = async () => {
    /* Set up browser */
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    this.browser = browser;
    this.page = page;
    try {
      const generateLinkUrl = "https://creators.joinmavely.com/home";
      await page.goto(generateLinkUrl);
      await new Promise(async (resolve) =>
        setTimeout(() => resolve("done"), 2000)
      );
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
      page.type("input#urlCompact:nth-child(2)", url);
      page.type("input#urlCompact:nth-child(1)", url);
      await page.evaluate((url) => {
        const inputs = document.querySelectorAll("input#urlCompact");
        if (!inputs.length) {
          console.log("urlCompact input not found");
          return;
        }

        Array.from(inputs).map((input) => {
          (input as HTMLInputElement).value = url; // Target the second input, if needed
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

  async generateMavelyLinkForUrl(
    embed: MessageEmbed,
    channelFrom: string
  ): Promise<string> {
    try {
      const date = new Date().toISOString();

      const { title, url } = embed;
      if (!url) return "";
      const originalUrl = url || "";
      const SUPPORTED_URL_DOMAINS = ["mavely"];
      const supportedDomain = SUPPORTED_URL_DOMAINS.some((domain) =>
        originalUrl.includes(domain)
      );
      if (!supportedDomain) return originalUrl;

      console.log("💫 Handling a message: ", title, url);

      const { endUrl, endUrlClean } = await this.parseUrl(originalUrl);
      const finalLink = await this.generateMavelyLink(endUrlClean);
      if (!finalLink) {
        console.log("finalLink not found for: ", url, endUrlClean);
        return originalUrl;
      }

      const relevantContent = {
        title,
        channelFrom,
        url,
        endUrl,
        endUrlClean,
        finalLink,
        date,
      };
      fs.appendFileSync(
        "embed.json",
        JSON.stringify(relevantContent, null, 2) + ",\n"
      );
      fs.appendFileSync(
        "embed.csv",
        `${title}|${channelFrom}|${url}|${endUrl}|${endUrlClean}|${finalLink}|${date}\n`
      );

      console.log("💥 Final Mavely Link:", finalLink);
      return finalLink;
    } catch (error) {
      this.logErrors("Mirrors.generateMavelyLinkForUrl", error as Error);
      return "";
    }
  }

  async discordMessageHandler(
    message: Message | PartialMessage,
    edited: Boolean = false,
    deleted: Boolean = false,
    channelFrom: string,
    mirror: Mirror,
    payload: WebhookMessageOptions
  ) {
    try {
      if (deleted) {
        const findMessage = this.mirroredMessages.find(
          (msg) => msg.from === message.id
        );

        if (findMessage)
          mirror.wh
            .deleteMessage(findMessage.to)
            .then(() => logger(`Mensagem deletada! De: ${channelFrom}`))
            .catch((err) => {
              logger(`Error ao deletar mensagem! De: ${channelFrom}\n\n`, err);
            });
      } else if (edited) {
        const findMessage = this.mirroredMessages.find(
          (msg) => msg.from === message.id
        );

        if (findMessage)
          mirror.wh
            .editMessage(findMessage.to, payload)
            .then(() => logger(`Mensagem editada! De: ${channelFrom}`))
            .catch((err) => {
              logger(`Error ao editar mensagem! De: ${channelFrom}\n\n`, err);
            });
      } else {
        mirror.wh
          .send(payload)
          .then((msg) => {
            logger(`Mensagem enviada! De: ${channelFrom}`);

            this.mirroredMessages.push({
              from: message.id,
              to: msg.id,
              expire: Date.now() + 24 * 60 * 60 * 1000, // 1 day
            });
          })
          .catch((err) => {
            logger(`Erro ao enviar mensagem! De: ${channelFrom}\n\n`, err);
          });
      }
    } catch (error) {
      this.logErrors(`Mirrors.discordMessageHandler`, error as Error);
    }
  }
  onMirror = async (
    message: Message | PartialMessage,
    edited: Boolean = false,
    deleted: Boolean = false
  ) => {
    try {
      if (!this.messageQueue) {
        console.log("no messageQueue defined");
      }

      const channelFrom = (await getChannel(message.channel.id)).name;

      const channelId =
        message.channel.isThread() &&
        message.channel.parent?.type === "GUILD_FORUM"
          ? (message.channel.parentId as string)
          : message.channelId;

      const mirror: Mirror | undefined = this.getMirror(channelId);
      if (!mirror) return;

      const payload = this.createPayload(message, mirror.settings);
      const replacedMessage = { ...message, payload };

      replacedMessage.embeds.forEach(async (embed) => {
        try {
          const date = new Date().toISOString();

          const { title, url } = embed;
          let finalUrl = url;
          console.log(date, " - url: ", url?.split("?")[0] || url);

          /* Save all messages received (collecting all url possibilities) */
          try {
            fs.appendFileSync(
              "logger.json",
              JSON.stringify({ title, url, channelFrom, date }, null, 2) + ",\n"
            );
            fs.appendFileSync(
              "logger.csv",
              `${title}|${channelFrom}|${url}|${date}\n`
            );
          } catch (fileError) {
            this.logErrors("onMirror - File Append", fileError as Error);
          }
          /* ============================================================= */

          if (!url?.includes("mavely")) return; // REMOVE THIS LATER, PREVENT LOG SPAM

          console.log("🔂 Adding message to the Queue");
          this.messageQueue.add(async () => {
            try {
              console.log("🔂 Proccesing queue message...");
              finalUrl = await this.generateMavelyLinkForUrl(
                embed,
                channelFrom
              );
              // await this.discordMessageHandler(
              //   message,
              //   edited,
              //   deleted,
              //   channelFrom,
              //   mirror,
              //   payload
              // );
              console.log("🔂 Message processed");
            } catch (queueError) {
              this.logErrors(
                "onMirror - Queue Processing",
                queueError as Error
              );
            }
          });
        } catch (embedError) {
          this.logErrors("onMirror - Embed Processing", embedError as Error);
        }
      });
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
      threadName: newMessage.channel.isThread()
        ? newMessage.channel.name
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
