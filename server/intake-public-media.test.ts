import { it, expect } from 'vitest';
import { publicMediaUrl } from './intake/publicMedia.js';
const env={PUBLIC_APP_URL:'https://preview.example',SUPABASE_URL:'http://127.0.0.1:56321'};
it('preserves signed path and query while routing phone reads through public preview',()=>{expect(publicMediaUrl('http://127.0.0.1:56321/storage/v1/object/sign/private/uuid?token=fixture',env)).toBe('https://preview.example/supabase/storage/v1/object/sign/private/uuid?token=fixture');});
it('does not proxy unrelated storage origins',()=>{const url='https://elsewhere.example/storage/v1/object/sign/private/uuid?token=fixture';expect(publicMediaUrl(url,env)).toBe(url);});
