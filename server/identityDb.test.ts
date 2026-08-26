import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIdentityStore, type IdentityStore } from './identityDb'

let store: IdentityStore
beforeEach(() => { store = createIdentityStore(':memory:') })
afterEach(() => { store.close() })

describe('identity store', () => {
  it('stores salted access-code hashes and authenticates active users', () => {
    const created = store.createUser({
      organizationId: 'household-1', email: 'HOME@example.com', displayName: 'Home Owner',
      role: 'homeowner', accessCode: 'strong-home-code',
    })
    if (!('user' in created)) throw new Error('user not created')
    expect(created.user).toMatchObject({ email: 'home@example.com', organizationId: 'household-1', active: true })
    expect(store.authenticate('home@example.com', 'wrong-code')).toBeNull()
    expect(store.authenticate('HOME@example.com', 'strong-home-code')).toMatchObject({ id: created.user.id, role: 'homeowner' })
    expect(store.createUser({
      organizationId: 'other', email: 'home@example.com', displayName: 'Duplicate', role: 'homeowner', accessCode: 'another-code',
    })).toEqual({ error: 'email_already_exists' })
  })

  it('prevents disabled users from authenticating', () => {
    const created = store.createUser({
      organizationId: 'provider-org', email: 'pro@example.com', displayName: 'Provider',
      role: 'provider', accessCode: 'provider-code',
    })
    if (!('user' in created)) throw new Error('user not created')
    expect(store.setUserActive(created.user.id, false)).toMatchObject({ active: false })
    expect(store.authenticate('pro@example.com', 'provider-code')).toBeNull()
    expect(store.listUsers()).toEqual([expect.objectContaining({ id: created.user.id, active: false })])
  })
})
