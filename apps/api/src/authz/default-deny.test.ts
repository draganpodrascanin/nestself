/**
 * Default-deny test -- every route handler must have an explicit security policy:
 *   @Public()        -> no authentication required
 *   @Authenticated() -> valid session or bearer, no authorization action
 *   @Authorize()     -> authorization check against an action/resource
 *
 * If this test fails, a route was added without declaring its security policy.
 *
 * @see T-1.6, AUTHZ-R-49
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
/** Internal NestJS metadata key for HTTP method; not re-exported from @nestjs/common in v12. */
const METHOD_METADATA = 'method';
/** NestJS WebSocket metadata keys from @nestjs/websockets/constants. */
const GATEWAY_METADATA = 'websockets:is_gateway';
const MESSAGE_MAPPING_METADATA = 'websockets:message_mapping';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { IS_AUTHENTICATED_ONLY_KEY } from './authenticated.decorator.js';
import { AUTHORIZE_KEY } from './authorize.decorator.js';

describe('Default-deny: every route has @Public, @Authenticated or @Authorize', () => {
  let module: TestingModule;

  const dbStub = {
    ping: async () => {},
    onModuleInit: async () => {},
    onModuleDestroy: async () => {},
  };

  afterAll(async () => {
    if (module) await module.close();
  });

  it('every handler must declare a security decorator', async () => {
    module = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(DbService)
      .useValue(dbStub)
      .compile();

    const discovery = module.get(DiscoveryService);
    const scanner = module.get(MetadataScanner);
    const reflector = module.get(Reflector);

    const controllers = discovery.getControllers();
    const violations: string[] = [];

    for (const wrapper of controllers) {
      const instance = wrapper.instance;
      if (!instance) continue;

      const controllerClass = instance.constructor;
      const className = controllerClass.name;
      const prototype = Object.getPrototypeOf(instance) as object;

      const methods = scanner.getAllMethodNames(prototype);
      for (const methodName of methods) {
        const handler = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
        if (httpMethod === undefined) continue;

        const targets = [handler, controllerClass];

        const isPublic = reflector.getAllAndOverride<boolean>(
          IS_PUBLIC_KEY, targets,
        );
        if (isPublic) continue;

        const isAuthOnly = reflector.getAllAndOverride<boolean>(
          IS_AUTHENTICATED_ONLY_KEY, targets,
        );
        if (isAuthOnly) continue;

        const authorize = reflector.getAllAndOverride<unknown>(
          AUTHORIZE_KEY, targets,
        );
        if (authorize) continue;

        violations.push(`${className}.${methodName}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Default-deny violation: the following handlers have no @Public(), ` +
        `@Authenticated() or @Authorize() metadata.\n\n` +
        violations.map((v) => `  - ${v}`).join('\n'),
      );
    }
  });

  it('covers the appointments controller: every route is @Authorize() except the @Authenticated() list and cancel (CW-R-87)', async () => {
    if (!module) {
      module = await Test.createTestingModule({
        imports: [AppModule, DiscoveryModule],
      })
        .overrideProvider(DbService)
        .useValue(dbStub)
        .compile();
    }

    const discovery = module.get(DiscoveryService);
    const scanner = module.get(MetadataScanner);
    const reflector = module.get(Reflector);

    const wrapper = discovery
      .getControllers()
      .find((w) => w.instance?.constructor.name === 'AppointmentsController');
    expect(wrapper, 'AppointmentsController is registered').toBeDefined();

    const instance = wrapper!.instance as object;
    const prototype = Object.getPrototypeOf(instance) as object;
    const policies: Record<string, string> = {};
    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
      const targets = [handler, instance.constructor];
      const authorize = reflector.getAllAndOverride<{ action: string } | undefined>(AUTHORIZE_KEY, targets);
      const authenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY_KEY, targets);
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
      policies[methodName] = isPublic
        ? 'public'
        : authenticated
          ? 'authenticated'
          : (authorize?.action ?? 'none');
    }

    expect(policies).toEqual({
      list: 'authenticated',
      get: 'consultation.join',
      create: 'bookings.coordinate',
      cancel: 'authenticated',
      // Follow-ups (T-CW-1.9, guidelines 7.1).
      proposeFollowUp: 'appointment.propose',
      confirmFollowUp: 'consultation.join',
      suggestTimes: 'consultation.join',
      scheduleFollowUp: 'appointment.propose',
      declineFollowUp: 'consultation.join',
    });
  });

  it('covers the calls controller: every route is @Authorize() with its canonical action (T-CW-1.1, CW-R-87)', async () => {
    if (!module) {
      module = await Test.createTestingModule({
        imports: [AppModule, DiscoveryModule],
      })
        .overrideProvider(DbService)
        .useValue(dbStub)
        .compile();
    }

    const discovery = module.get(DiscoveryService);
    const scanner = module.get(MetadataScanner);
    const reflector = module.get(Reflector);

    const wrapper = discovery.getControllers().find((w) => w.instance?.constructor.name === 'CallsController');
    expect(wrapper, 'CallsController is registered').toBeDefined();

    const instance = wrapper!.instance as object;
    const prototype = Object.getPrototypeOf(instance) as object;
    const policies: Record<string, string> = {};
    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
      const targets = [handler, instance.constructor];
      const authorize = reflector.getAllAndOverride<{ action: string } | undefined>(AUTHORIZE_KEY, targets);
      const authenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY_KEY, targets);
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
      policies[methodName] = isPublic ? 'public' : authenticated ? 'authenticated' : (authorize?.action ?? 'none');
    }

    expect(policies).toEqual({
      join: 'consultation.join',
      end: 'consultation.join',
      outcome: 'delivery.record',
      feedback: 'consultation.join',
      signal: 'consultation.join',
      location: 'consultation.join',
      clientEvents: 'consultation.join',
      problemReport: 'consultation.join',
      problemReportQueue: 'diagnostic.read',
      diagnostics: 'diagnostic.read',
    });
  });

  it('covers the webinar controllers: canonical actions, and @Authenticated() where the service decides (T-CW-2.1, CW-R-31a)', async () => {
    if (!module) {
      module = await Test.createTestingModule({
        imports: [AppModule, DiscoveryModule],
      })
        .overrideProvider(DbService)
        .useValue(dbStub)
        .compile();
    }

    const discovery = module.get(DiscoveryService);
    const scanner = module.get(MetadataScanner);
    const reflector = module.get(Reflector);

    const policiesOf = (controller: string): Record<string, string> => {
      const wrapper = discovery.getControllers().find((w) => w.instance?.constructor.name === controller);
      expect(wrapper, `${controller} is registered`).toBeDefined();
      const instance = wrapper!.instance as object;
      const prototype = Object.getPrototypeOf(instance) as object;
      const policies: Record<string, string> = {};
      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const targets = [handler, instance.constructor];
        const authorize = reflector.getAllAndOverride<{ action: string } | undefined>(AUTHORIZE_KEY, targets);
        const authenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY_KEY, targets);
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        policies[methodName] = isPublic ? 'public' : authenticated ? 'authenticated' : (authorize?.action ?? 'none');
      }
      return policies;
    };

    expect(policiesOf('WebinarsController')).toEqual({
      list: 'event.register',
      // Attendee, registrant, host or moderating staff: decided in the service.
      get: 'authenticated',
      register: 'event.register',
      unregister: 'event.register',
      // Hosts and registered attendees (WBN-07, WBN-16).
      join: 'authenticated',
      // event.present or event.moderate on the occurrence, checked in the service (CW-R-31a).
      start: 'authenticated',
      end: 'authenticated',
      // Attendees (event.register) and hosts (WBN-37) alike.
      createMessage: 'authenticated',
      listMessages: 'authenticated',
      publishMessage: 'event.moderate',
      answerMessage: 'event.moderate',
      dismissMessage: 'event.moderate',
      raiseHand: 'event.register',
      lowerHand: 'event.register',
      // event.moderate or event.present (WBN-25).
      giveFloor: 'authenticated',
      takeFloor: 'authenticated',
      createPoll: 'event.moderate',
      openPoll: 'event.moderate',
      closePoll: 'event.moderate',
      vote: 'event.register',
    });

    expect(policiesOf('WebinarsOpsController')).toEqual({
      // The admin index (an addition to the canonical routes): manage or moderate, in the service.
      list: 'authenticated',
      create: 'event.manage',
      update: 'event.manage',
      publish: 'event.manage',
      cancel: 'event.manage',
      // event.manage or event.moderate (WBN-33), in the service.
      attendance: 'authenticated',
    });
  });

  it('every @WebSocketGateway @SubscribeMessage handler must declare a security decorator (AUTHZ-R-62)', async () => {
    if (!module) {
      module = await Test.createTestingModule({
        imports: [AppModule, DiscoveryModule],
      })
        .overrideProvider(DbService)
        .useValue(dbStub)
        .compile();
    }

    const discovery = module.get(DiscoveryService);
    const scanner = module.get(MetadataScanner);
    const reflector = module.get(Reflector);

    const providers = discovery.getProviders();
    const violations: string[] = [];

    for (const wrapper of providers) {
      const instance = wrapper.instance;
      if (!instance) continue;

      const gatewayClass = instance.constructor;

      // Check if this class is a @WebSocketGateway
      const isGateway = Reflect.getMetadata(GATEWAY_METADATA, gatewayClass);
      if (!isGateway) continue;

      const className = gatewayClass.name;
      const prototype = Object.getPrototypeOf(instance) as object;
      const methods = scanner.getAllMethodNames(prototype);

      for (const methodName of methods) {
        const handler = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        // Check if method has @SubscribeMessage
        const isMessageHandler = Reflect.getMetadata(
          MESSAGE_MAPPING_METADATA,
          handler,
        );
        if (!isMessageHandler) continue;

        const targets = [handler, gatewayClass];

        const isPublic = reflector.getAllAndOverride<boolean>(
          IS_PUBLIC_KEY,
          targets,
        );
        if (isPublic) continue;

        const isAuthOnly = reflector.getAllAndOverride<boolean>(
          IS_AUTHENTICATED_ONLY_KEY,
          targets,
        );
        if (isAuthOnly) continue;

        const authorize = reflector.getAllAndOverride<unknown>(
          AUTHORIZE_KEY,
          targets,
        );
        if (authorize) continue;

        violations.push(`${className}.${methodName}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Default-deny violation: the following WebSocket handlers have no @Public(), ` +
          `@Authenticated() or @Authorize() metadata.\n\n` +
          violations.map((v) => `  - ${v}`).join('\n'),
      );
    }
  });
});
