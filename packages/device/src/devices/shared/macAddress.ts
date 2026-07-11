import * as v from "valibot";

export const MacAddressSchema = v.pipe(
  v.string(),
  v.regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, "Invalid MAC address format"),
);
