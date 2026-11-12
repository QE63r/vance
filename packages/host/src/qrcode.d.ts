declare module "qrcode" {
  export function toDataURL(
    text: string,
    options?: {
      width?: number;
      margin?: number;
      color?: { dark?: string; light?: string };
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    },
  ): Promise<string>;
  export function toString(
    text: string,
    options?: {
      type?: "svg" | "utf8" | "terminal";
      margin?: number;
      width?: number;
    },
  ): Promise<string>;
}
