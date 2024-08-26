import { Client, ClientOptions } from "discord.js-selfbot-v13";

import { Config } from "./Config";
import { Mirrors } from "./Mirrors";

export = class extends Client {
  config?: Config;
  mirrors?: Mirrors;

  constructor(options: ClientOptions | undefined) {
    super(options);
  }
};
