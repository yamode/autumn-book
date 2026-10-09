import { describe, expect, it } from 'vitest';
import { accountStatus, accountTabs, canManageAccount, canManageUsers } from './partner-account-roles';

const P1 = 'partner-1';
const P2 = 'partner-2';
const master = { id: 'm1', partner_id: P1, is_master: true, is_active: true };
const otherMaster = { id: 'm2', partner_id: P1, is_master: true, is_active: true };
const child = { id: 'c1', partner_id: P1, is_master: false, is_active: true };
const child2 = { id: 'c2', partner_id: P1, is_master: false, is_active: true };
const foreignChild = { id: 'c9', partner_id: P2, is_master: false, is_active: true };

describe('canManageUsers', () => {
  it('有効なマスタだけがユーザー管理を使える', () => {
    expect(canManageUsers(master)).toBe(true);
    expect(canManageUsers(child)).toBe(false);
    expect(canManageUsers({ ...master, is_active: false })).toBe(false);
  });
});

describe('canManageAccount', () => {
  it('マスタは同じ取引先の子ユーザーを操作できる', () => {
    expect(canManageAccount(master, child)).toBe(true);
  });
  it('マスタ自身・他のマスタは操作できない', () => {
    expect(canManageAccount(master, master)).toBe(false);
    expect(canManageAccount(master, otherMaster)).toBe(false);
  });
  it('別の取引先の子ユーザーは操作できない', () => {
    expect(canManageAccount(master, foreignChild)).toBe(false);
  });
  it('子ユーザーは誰も操作できない', () => {
    expect(canManageAccount(child, child2)).toBe(false);
    expect(canManageAccount(child, child)).toBe(false);
    expect(canManageAccount(child, master)).toBe(false);
  });
  it('停止中のマスタは操作できない', () => {
    expect(canManageAccount({ ...master, is_active: false }, child)).toBe(false);
  });
  it('停止中の子ユーザーも（再開のために）操作できる', () => {
    expect(canManageAccount(master, { ...child, is_active: false })).toBe(true);
  });
});

describe('accountStatus', () => {
  it('停止・設定待ち・有効を見分ける', () => {
    expect(accountStatus({ is_active: false, password_hash: 'x' })).toBe('disabled');
    expect(accountStatus({ is_active: true, password_hash: null, password_set_at: null })).toBe('pending');
    expect(accountStatus({ is_active: true, password_hash: 'x', password_set_at: '2026-10-01T00:00:00Z' })).toBe('active');
  });
});

describe('accountTabs', () => {
  it('ユーザー管理はマスタだけに出す', () => {
    expect(accountTabs(true).map((t) => t.path)).toEqual(['', 'invoices', 'cards', 'security', 'users']);
    expect(accountTabs(false).map((t) => t.path)).toEqual(['', 'invoices', 'cards', 'security']);
  });
});
