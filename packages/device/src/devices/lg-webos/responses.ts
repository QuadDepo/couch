import * as v from "valibot";

const InstalledAppsSchema = v.object({
  apps: v.array(v.looseObject({ id: v.string() })),
});
const ForegroundAppSchema = v.object({ appId: v.string() });
const CaptureSchema = v.object({ imageUri: v.pipe(v.string(), v.minLength(1)) });

function parse<T>(
  schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
  value: unknown,
  name: string,
): T {
  const result = v.safeParse(schema, value);
  if (!result.success) throw new Error(`LG webOS returned an invalid ${name} response`);
  return result.output;
}

export const parseInstalledApps = (value: unknown) => parse(InstalledAppsSchema, value, "app list");
export const parseForegroundApp = (value: unknown) =>
  parse(ForegroundAppSchema, value, "foreground app");
export const parseCapture = (value: unknown) => parse(CaptureSchema, value, "capture");
