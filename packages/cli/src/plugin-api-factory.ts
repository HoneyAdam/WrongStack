import {
  DefaultPluginAPI,
  type PluginAPIInit,
  type PluginAPI,
} from '@wrongstack/core';

export default function createApi(ownerName: string, base: Omit<PluginAPIInit, 'ownerName'>): PluginAPI {
  return new DefaultPluginAPI({ ownerName, ...base });
}
