import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  DemoRequestSchema,
  ContactMessageSchema,
  WebinarRegistrationSchema,
} from '@nestself/contracts';
import type { DemoRequest, ContactMessage, WebinarRegistration } from '@nestself/contracts';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { LeadsService } from './leads.service.js';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('demo-requests')
  async createDemoRequest(
    @Body(new ZodValidationPipe(DemoRequestSchema)) body: DemoRequest,
  ) {
    return this.leadsService.accept(body);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('contact')
  async createContact(
    @Body(new ZodValidationPipe(ContactMessageSchema)) body: ContactMessage,
  ) {
    return this.leadsService.accept(body);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('webinar-registrations')
  async createWebinarRegistration(
    @Body(new ZodValidationPipe(WebinarRegistrationSchema))
    body: WebinarRegistration,
  ) {
    return this.leadsService.accept(body);
  }
}
