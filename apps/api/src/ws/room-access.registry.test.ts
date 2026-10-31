/**
 * RoomAccessRegistry (T-CW-1.6): the module that owns a room kind registers
 * the server-side resolver of its rooms; nothing else can.
 */
import { describe, expect, it } from 'vitest';
import { RoomAccessRegistry, type RoomTargetResolver } from './room-access.registry.js';

const resolver: RoomTargetResolver = async () => null;

describe('RoomAccessRegistry', () => {
  it('has no resolver for a kind nobody registered', () => {
    const registry = new RoomAccessRegistry();
    expect(registry.resolverFor('call')).toBeUndefined();
    expect(registry.resolverFor('webinar')).toBeUndefined();
    expect(registry.resolverFor('webinar_moderation')).toBeUndefined();
  });

  it('returns the registered resolver', () => {
    const registry = new RoomAccessRegistry();
    registry.register('call', resolver);
    expect(registry.resolverFor('call')).toBe(resolver);
    expect(registry.resolverFor('webinar')).toBeUndefined();
  });

  it('refuses a second resolver for the same kind', () => {
    const registry = new RoomAccessRegistry();
    registry.register('call', resolver);
    expect(() => registry.register('call', async () => null)).toThrow(/call/);
  });

  it('unregisters', () => {
    const registry = new RoomAccessRegistry();
    registry.register('call', resolver);
    registry.unregister('call');
    expect(registry.resolverFor('call')).toBeUndefined();
  });
});
