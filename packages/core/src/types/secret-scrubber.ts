export interface SecretScrubber {
  scrub(text: string): string;
  scrubObject<T>(obj: T): T;
}
