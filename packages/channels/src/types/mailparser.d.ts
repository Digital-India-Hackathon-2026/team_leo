declare module "mailparser" {
  import type { Readable } from "node:stream";

  interface AddressValue {
    address?: string;
    name?: string;
  }

  interface AddressObject {
    value: AddressValue[];
    text?: string;
  }

  interface ParsedMail {
    from?: AddressObject;
    to?: AddressObject;
    subject?: string;
    text?: string;
    html?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
    date?: Date;
  }

  export function simpleParser(source: Buffer | Readable | string): Promise<ParsedMail>;
}
