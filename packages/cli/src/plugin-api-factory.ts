import { DefaultPluginAPI, type PluginAPI, type PluginAPIInit } from '@wrongstack/core/plugin';

export default function createApi(
  ownerName: string,
  base: Omit<PluginAPIInit, 'ownerName'>,
): PluginAPI {
  return new DefaultPluginAPI({ ownerName, ...base });
}
