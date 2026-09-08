import { File } from 'expo-file-system';
import { FormInputError } from './formValues';
export async function documentUpload(kind: string, asset: { readonly uri: string; readonly name: string }): Promise<FormData> {
  const file = new File(asset.uri);
  if (file.size > 10_000_000) throw new FormInputError('file_size');
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file, asset.name);
  return form;
}
