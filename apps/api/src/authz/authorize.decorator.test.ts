import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ACTIONS, type Action } from '@nestself/contracts';
import { AUTHORIZE_KEY, Authorize, type AuthorizeMetadata, type ResourceResolver } from './authorize.decorator.js';
import { IS_AUTHENTICATED_ONLY_KEY } from './authenticated.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

const resolver: ResourceResolver = () => ({ type: 'membership', orgId: 'org_1' });

const ANY_OF: Action[] = [ACTIONS['program.overview'], ACTIONS['access.preview']];

class Probe {
  @Authorize(ACTIONS['program.overview'], resolver)
  single(): void {}

  @Authorize(ANY_OF, resolver)
  anyOf(): void {}
}

const reflector = new Reflector();
const metadataOf = (handler: () => void): AuthorizeMetadata | undefined =>
  reflector.get<AuthorizeMetadata | undefined>(AUTHORIZE_KEY, handler);

describe('@Authorize()', () => {
  it('stores a single action as a list of one', () => {
    expect(metadataOf(Probe.prototype.single)).toEqual({ actions: ['program.overview'], resolver });
  });

  it('stores several actions in the order they were listed', () => {
    expect(metadataOf(Probe.prototype.anyOf)).toEqual({
      actions: ['program.overview', 'access.preview'],
      resolver,
    });
  });

  it('keeps its own copy of the list', () => {
    const listed: Action[] = [ACTIONS['program.overview']];
    class Copy {
      @Authorize(listed, resolver)
      handler(): void {}
    }
    listed.push(ACTIONS['access.preview']);

    expect(metadataOf(Copy.prototype.handler)?.actions).toEqual(['program.overview']);
  });

  it('refuses an empty list when the route is declared, since it would deny every caller', () => {
    expect(() => Authorize([], resolver)).toThrow('at least one action');
  });

  // The default-deny test accepts a route when this lookup finds metadata.
  it.each([
    ['one action', Probe.prototype.single],
    ['a list of actions', Probe.prototype.anyOf],
  ])('is found by the default-deny lookup for %s', (_name, handler) => {
    expect(reflector.getAllAndOverride(AUTHORIZE_KEY, [handler, Probe])).toBeTruthy();
    expect(reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, Probe])).toBeUndefined();
    expect(reflector.getAllAndOverride(IS_AUTHENTICATED_ONLY_KEY, [handler, Probe])).toBeUndefined();
  });
});
