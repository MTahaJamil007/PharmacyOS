import { BadRequestException, Body, Controller, Inject, Post, Req, SetMetadata } from '@nestjs/common';
import { loginSchema } from '@pharmacy/shared';
import type { FastifyRequest } from 'fastify';

import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('login')
  @SetMetadata('public', true)
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    const result = loginSchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.authService.login(result.data, request.ip);
  }
}
