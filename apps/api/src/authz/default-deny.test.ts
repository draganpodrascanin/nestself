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

  it('covers the appointments controller: every route is @Authorize() except the @Authenticated() list, read, cancel and expert lookup (CW-R-87)', async () => {
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
      const authorize = reflector.getAllAndOverride<{ actions: string[] } | undefined>(AUTHORIZE_KEY, targets);
      const authenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY_KEY, targets);
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
      policies[methodName] = isPublic
        ? 'public'
        : authenticated
          ? 'authenticated'
          : (authorize?.actions[0] ?? 'none');
    }

    expect(policies).toEqual({
      list: 'authenticated',
      get: 'authenticated',
      expertCandidates: 'authenticated',
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
      const authorize = reflector.getAllAndOverride<{ actions: string[] } | undefined>(AUTHORIZE_KEY, targets);
      const authenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY_KEY, targets);
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
      policies[methodName] = isPublic ? 'public' : authenticated ? 'authenticated' : (authorize?.actions[0] ?? 'none');
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
        const authorize = reflector.getAllAndOverride<{ actions: string[] } | undefined>(AUTHORIZE_KEY, targets);
        const authenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY_KEY, targets);
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        policies[methodName] = isPublic ? 'public' : authenticated ? 'authenticated' : (authorize?.actions[0] ?? 'none');
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
      // WBN-26: hosts mute and ask (decided in the service); the attendee unmutes their own floor.
      muteFloor: 'authenticated',
      requestUnmute: 'authenticated',
      unmuteFloor: 'event.register',
      createPoll: 'event.moderate',
      openPoll: 'event.moderate',
      closePoll: 'event.moderate',
      vote: 'event.register',
      // Poll state for registrants and hosts, results for hosts after the close: decided in the service.
      listPolls: 'authenticated',
      pollResults: 'authenticated',
      // The moderator's early stop (T-CW-2.5); the status for hosts and operations, decided in the service.
      stopRecording: 'event.moderate',
      recordingStatus: 'authenticated',
    });

    expect(policiesOf('WebinarsOpsController')).toEqual({
      // The admin index (an addition to the canonical routes): manage or moderate, in the service.
      list: 'authenticated',
      // The occurrence form's lookups and the detail: event.manage (or event.moderate for the detail), in the service.
      hostCandidates: 'authenticated',
      get: 'authenticated',
      organisations: 'authenticated',
      units: 'event.manage',
      create: 'event.manage',
      update: 'event.manage',
      publish: 'event.manage',
      cancel: 'event.manage',
      // event.manage or event.moderate (WBN-33), in the service.
      attendance: 'authenticated',
    });
  });

  it('covers the employee listening controllers: canonical actions, and @Authenticated() where the assignment is checked in the service (ADR 0002)', async () => {
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
        const authorize = reflector.getAllAndOverride<{ actions: string[] } | undefined>(AUTHORIZE_KEY, targets);
        const authenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY_KEY, targets);
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
        policies[methodName] = isPublic ? 'public' : authenticated ? 'authenticated' : (authorize?.actions[0] ?? 'none');
      }
      return policies;
    };

    // Surveys and reports (spec SUR, REP): the employee's own participation in the personal context, the employer's reports in the organization context.
    expect(policiesOf('ListeningController')).toEqual({
      mySurvey: 'listening.respond.self',
      saveDraft: 'listening.respond.self',
      submit: 'listening.respond.self',
      listCycles: 'listening.cycles.manage',
      scheduleCycle: 'listening.cycles.manage',
      cancelCycle: 'listening.cycles.manage',
      overview: 'listening.reports.read',
      heatmap: 'listening.reports.read',
      dimension: 'listening.reports.read',
      dismissOffer: 'workplace_reviews.request',
      exportCsv: 'listening.reports.export',
      // Reporting users and survey administrators both read the rules; the decorator carries both actions.
      readConfiguration: 'listening.reports.read',
    });

    expect(policiesOf('ListeningOpsController')).toEqual({
      getConfiguration: 'listening.configure',
      updateConfiguration: 'listening.configure',
      listQuestionnaires: 'listening.templates.write',
      createQuestionnaire: 'listening.templates.write',
      updateQuestionnaire: 'listening.templates.write',
      submitReview: 'listening.templates.write',
      archive: 'listening.templates.write',
      publish: 'listening.templates.publish',
    });

    // Feedback cases (spec FBK): the reporter's own case and the handler's inbox are resolved in the service, because the
    // case row is confidential and the reporter link is the only way to know it is theirs (PRI-03).
    expect(policiesOf('FeedbackCasesController')).toEqual({
      routesForEmployee: 'feedback_case.create.self',
      create: 'feedback_case.create.self',
      listMine: 'feedback_case.read.self',
      readMine: 'authenticated',
      replyMine: 'authenticated',
      inbox: 'authenticated',
      readAssigned: 'feedback_case.handle',
      postMessage: 'feedback_case.handle',
      setState: 'feedback_case.handle',
      reassign: 'feedback_case.assign',
      listRoutes: 'org.settings',
      updateRoutes: 'org.settings',
    });

    // Workplace reviews (spec REV): the requester, the approver (financial step-up) and the action owner on the employer side.
    expect(policiesOf('WorkplaceReviewsController')).toEqual({
      services: 'workplace_reviews.request',
      create: 'workplace_reviews.request',
      list: 'workplace_reviews.request',
      get: 'workplace_reviews.request',
      cancelRequest: 'workplace_reviews.request',
      answerInformation: 'workplace_reviews.request',
      acceptScope: 'workplace_reviews.scope.accept',
      rejectScope: 'workplace_reviews.scope.accept',
      listEngagements: 'workplace_reviews.engagement.read',
      getEngagement: 'workplace_reviews.engagement.read',
      book: 'workplace_reviews.request',
      cancelEngagement: 'workplace_reviews.request',
      share: 'workplace_reviews.request',
      revoke: 'workplace_reviews.request',
      report: 'workplace_reviews.engagement.read',
      listActions: 'workplace_reviews.engagement.read',
      createAction: 'workplace_reviews.actions.manage',
      updateAction: 'workplace_reviews.actions.manage',
    });

    expect(policiesOf('WorkplaceReviewsOpsController')).toEqual({
      services: 'workplace_reviews.coordinate',
      queue: 'workplace_reviews.coordinate',
      get: 'workplace_reviews.coordinate',
      triage: 'workplace_reviews.coordinate',
      sendScope: 'workplace_reviews.coordinate',
      reviewers: 'workplace_reviews.coordinate',
      engagement: 'workplace_reviews.coordinate',
      assign: 'workplace_reviews.coordinate',
      windows: 'workplace_reviews.coordinate',
      cancel: 'workplace_reviews.coordinate',
    });

    // The reviewer's routes: the assignment (a CASE-like reviewer assignment on the engagement) is checked in the service,
    // and `workplace_reviews.report.write` / `.publish` through `AuthorizationService.require` on the engagement resource.
    expect(policiesOf('WorkplaceReviewsExpertController')).toEqual({
      list: 'authenticated',
      get: 'authenticated',
      pack: 'authenticated',
      report: 'authenticated',
      saveReport: 'authenticated',
      submitReview: 'authenticated',
      share: 'authenticated',
      notes: 'authenticated',
      addNote: 'authenticated',
      listActions: 'authenticated',
      propose: 'authenticated',
      followUp: 'authenticated',
      complete: 'authenticated',
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
