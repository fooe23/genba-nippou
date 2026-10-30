import { describe, it, expect } from 'vitest';
import { APP_NAME } from '@/lib/constants';
describe('smoke', () => { it('アプリ名', () => { expect(APP_NAME).toBe('現場日報'); }); });
