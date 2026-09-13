/**
 * Vitest 설정: server/ 아래의 *.test.ts만 수집한다(모바일은 별도 node --test).
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
  },
})
