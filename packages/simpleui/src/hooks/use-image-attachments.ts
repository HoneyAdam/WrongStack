import { useCallback, useState } from 'react';

export interface AttachedImage {
  id: string;
  data: string;
  mime: string;
  name: string;
}

export interface UseImageAttachmentsResult {
  attachedImages: AttachedImage[];
  attachImages: () => void;
  removeImage: (id: string) => void;
  setAttachedImages: React.Dispatch<React.SetStateAction<AttachedImage[]>>;
}

function generateId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Owns the image attachment lifecycle: triggering the file picker, reading
 * selected files as base64 data URLs, and removing individual images.
 *
 * Behavioural contract (must survive the PR-5 extraction from `app.tsx`):
 *  - `attachImages()` creates a hidden `<input type="file" accept="image/*"
 *    multiple>` element, programmatically clicks it, and reads each selected
 *    file via `FileReader.readAsDataURL`. The input is removed after the
 *    change event fires.
 *  - Each image is stored as `{ id, data, mime, name }` where `data` is the
 *    full `data:<mime>;base64,...` URL.
 *  - `removeImage(id)` filters the array by id.
 *  - Multiple images can be attached; each gets a unique id.
 *  - If the user cancels the file picker (no files selected), nothing happens.
 */
export function useImageAttachments(): UseImageAttachmentsResult {
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  const attachImages = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      const readers: Promise<AttachedImage>[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        readers.push(
          new Promise<AttachedImage>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                id: generateId(),
                data: reader.result as string,
                mime: file.type || 'image/png',
                name: file.name,
              });
            };
            reader.readAsDataURL(file);
          }),
        );
      }
      void Promise.all(readers).then((images) => {
        setAttachedImages((current) => [...current, ...images]);
      });
      // Clean up the input element.
      input.remove();
    });

    document.body.append(input);
    input.click();
  }, []);

  const removeImage = useCallback((id: string) => {
    setAttachedImages((current) => current.filter((img) => img.id !== id));
  }, []);

  return {
    attachedImages,
    attachImages,
    removeImage,
    setAttachedImages,
  };
}
