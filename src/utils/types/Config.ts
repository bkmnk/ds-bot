import { readFileSync } from "fs";
import { parse as YAML } from "yaml";
import { TMirrorProps } from "./Mirrors";
import { config } from "dotenv";

config();
type TConfigProps = {
  token: string;
  mirrors: TMirrorProps[];
};

export class Config {
  private props: TConfigProps;

  constructor(path: string) {
    const file = readFileSync(path, "utf-8");
    const config = YAML(file);
    const token = String(process.env.DISCORD_TOKEN);
    this.props = { ...config, token };
  }

  public getToken() {
    return this.props.token;
  }

  public getMirrors() {
    return this.props.mirrors;
  }
}
