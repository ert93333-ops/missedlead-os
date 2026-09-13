/**
 * 웹 서류 업로드: asset URI를 fetch해 Blob으로 변환 후 FormData 구성.
 */
import { FormInputError } from './formValues';
export async function documentUpload(kind: string, asset: { readonly uri: string; readonly name: string }): Promise<FormData> {
  const response = await globalThis.fetch(asset.uri, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Selected document could not be read');
  const file = await response.blob();
  if (file.size > 10_000_000) throw new FormInputError('file_size');
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file, asset.name);
  return form;
}
