import { Message, PartialMessage } from "discord.js-selfbot-v13";

import axios from "axios";
import { config } from "dotenv";

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";

import { TMirrorSettings } from "./types/Mirrors";

type TChannel = { id: string; name: string; parent_id: string };
const channels: TChannel[] = [];

/**
 * Text replacement method
 * @param message Message to convert Webhook Message Option
 * @param settings Mirror Settings
 * @returns {Message<boolean> | PartialMessage}
 */
export const replacer = (
  message: Message | PartialMessage,
  settings: TMirrorSettings
) => {
  const newMsg: Message | PartialMessage = message;

  settings.replacers.forEach((r) => {
    switch (r.where) {
      case "content":
        return (newMsg.content =
          r.replace !== "*"
            ? (newMsg.content?.replace(r.replace, r.with) as string)
            : r.with);
      case "embed_author":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.author)
            r.replace !== "*"
              ? (embed.author.name = embed.author.name.replace(
                  r.replace,
                  r.with
                ))
              : (embed.author.name = r.with);

          return embed;
        }));
      case "embed_author_icon":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.author?.iconURL)
            r.replace !== "*"
              ? (embed.author.iconURL = embed.author.iconURL.replace(
                  r.replace,
                  r.with
                ))
              : (embed.author.iconURL = r.with);

          return embed;
        }));
      case "embed_author_url":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.author?.url)
            r.replace !== "*"
              ? (embed.author.url = embed.author.url.replace(r.replace, r.with))
              : (embed.author.url = r.with);

          return embed;
        }));
      case "embed_url":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.url)
            r.replace !== "*"
              ? (embed.url = embed.url.replace(r.replace, r.with))
              : (embed.url = r.with);

          return embed;
        }));
      case "embed_title":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.title)
            r.replace !== "*"
              ? (embed.title = embed.title.replace(r.replace, r.with))
              : (embed.title = r.with);

          return embed;
        }));
      case "embed_description":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.description)
            r.replace !== "*"
              ? (embed.description = embed.description.replace(
                  r.replace,
                  r.with
                ))
              : (embed.description = r.with);

          return embed;
        }));
      case "embed_fields_name":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.fields.length > 0)
            embed.fields = embed.fields.map((field) => {
              r.replace !== "*"
                ? (field.name = field.name.replace(r.replace, r.with))
                : (field.name = r.with);

              return field;
            });

          return embed;
        }));
      case "embed_fields_value":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.fields.length > 0)
            embed.fields = embed.fields.map((field) => {
              r.replace !== "*"
                ? (field.value = field.value.replace(r.replace, r.with))
                : (field.value = r.with);

              return field;
            });

          return embed;
        }));
      case "embed_footer":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.footer?.text)
            r.replace !== "*"
              ? (embed.footer.text = embed.footer.text.replace(
                  r.replace,
                  r.with
                ))
              : (embed.footer.text = r.with);

          return embed;
        }));
      case "embed_footer_icon":
        return (newMsg.embeds = newMsg.embeds.map((embed) => {
          if (embed.footer?.iconURL)
            r.replace !== "*"
              ? (embed.footer.iconURL = embed.footer.iconURL.replace(
                  r.replace,
                  r.with
                ))
              : (embed.footer.iconURL = r.with);

          return embed;
        }));
    }
  });

  return newMsg;
};

/**
 * Search channels by ID
 * @param channel Channel id to search
 * @returns Channel found or undefined
 */

config();
export const getChannel: (channel: string) => Promise<TChannel> = async (
  channel
) => {
  const findCh = channels.filter((ch) => ch.id === channel);
  if (findCh.length > 0) return findCh[0];

  const endpoint = `https://discord.com/api/v9/channels/${channel}`;
  const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN);
  return await axios
    .get(endpoint, {
      headers: {
        Authorization: DISCORD_TOKEN,
      },
    })
    .then((res) => {
      channels.push(res.data);
      return res.data;
    });
};

/**
 * Logger in screnn and file
 * @param args String texts to log
 */
export const logger = (...args: any[]) => {
  const path = "./logs";
  const text = args.join(" ");

  if (!existsSync(path)) {
    writeFileSync(path, `${new Date()} | [LOG]: ${text}\n`);
  } else {
    appendFileSync(path, `${new Date()} | [LOG]: ${text}\n`);
  }

  console.log("[\x1b[33mLOG\x1b[0m]:", text);
};

/**
 * The beautiful BRAND!
 * @param version Show version in brand 😎
 */
export const brand = (version: string | boolean = false) => {
  console.clear();
  console.log(
    [
      "\x1b[6m\x1b[34m               ",
      "██████╗   ███╗   ███╗  ███╗   ███╗",
      "██╔══██╗  ████╗ ████║  ████╗ ████║",
      "██║  ██║  ██╔████╔██║  ██╔████╔██║",
      "██║  ██║  ██║╚██╔╝██║  ██║╚██╔╝██║",
      "██████╔╝  ██║ ╚═╝ ██║  ██║ ╚═╝ ██║",
      "╚═════╝   ╚═╝     ╚═╝  ╚═╝     ╚═╝",
      `\x1b[0mDiscord Mirror Messages (${version ? "v" + version : ""})`,
      "",
    ].join("\n")
  );
};
