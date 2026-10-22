import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { LeadsRepository } from '../db/repositories/leads.repository.js';

describe('LeadsController (e2e)', () => {
  let app: INestApplication;
  const leadCreateMock = vi.fn();

  const dbStub = {
    ping: async () => {},
    onModuleInit: async () => {},
    onModuleDestroy: async () => {},
  };

  beforeEach(async () => {
    leadCreateMock.mockReset();
    leadCreateMock.mockResolvedValue({
      id: 'lead_1',
      createdAt: new Date('2026-10-21T10:00:00Z'),
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DbService)
      .useValue(dbStub)
      .overrideProvider(LeadsRepository)
      .useValue({ insert: leadCreateMock })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/leads/demo-requests', () => {
    const validBody = {
      kind: 'demo_request',
      name: 'Test Person',
      email: 'Test@Example.com',
      company: 'Example d.o.o.',
      companySize: '51-200',
      country: 'RS',
      locale: 'en',
      consent: true,
    };

    it('returns 202 with id, kind and receivedAt for a valid request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/leads/demo-requests')
        .send(validBody);

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id', 'lead_1');
      expect(res.body).toHaveProperty('kind', 'demo_request');
      expect(res.body).toHaveProperty('receivedAt');
    });

    it('inserts the lead with correct kind, email, locale and payload containing company', async () => {
      await request(app.getHttpServer())
        .post('/api/leads/demo-requests')
        .send(validBody);

      expect(leadCreateMock).toHaveBeenCalledTimes(1);
      const row = leadCreateMock.mock.calls[0]![0];
      expect(row.kind).toBe('DEMO_REQUEST');
      expect(row.email).toBe('test@example.com');
      expect(row.locale).toBe('en');
      expect(row.payload).toHaveProperty('company', 'Example d.o.o.');
    });

    it('returns 400 with issues for an invalid body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/leads/demo-requests')
        .send({ kind: 'demo_request' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('issues');
      expect(Array.isArray(res.body.issues)).toBe(true);
    });

    it('returns 202 but does not insert a lead for a filled honeypot', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/leads/demo-requests')
        .send({ ...validBody, website: 'http://spam.com' });

      // Honeypot-filled requests pass validation but the service silently discards them
      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('kind', 'demo_request');
      expect(leadCreateMock).not.toHaveBeenCalled();
    });

    it('is public (no Authorization header needed)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/leads/demo-requests')
        .send(validBody);

      expect(res.status).not.toBe(401);
    });
  });

  describe('POST /api/leads/contact', () => {
    const validBody = {
      kind: 'contact',
      name: 'Test Person',
      email: 'test@example.com',
      subject: 'Inquiry',
      message: 'Hello, I have a question.',
      locale: 'sr-Latn',
      consent: true,
    };

    it('returns 202 for a valid contact message', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/leads/contact')
        .send(validBody);

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id', 'lead_1');
      expect(res.body).toHaveProperty('kind', 'contact');
    });
  });

  describe('POST /api/leads/webinar-registrations', () => {
    const validBody = {
      kind: 'webinar_registration',
      webinarSlug: 'stress-management-101',
      name: 'Test Person',
      email: 'test@example.com',
      locale: 'hu',
      consent: true,
    };

    it('returns 202 for a valid webinar registration', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/leads/webinar-registrations')
        .send(validBody);

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id', 'lead_1');
      expect(res.body).toHaveProperty('kind', 'webinar_registration');
    });
  });
});
