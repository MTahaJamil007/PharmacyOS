import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { failedJobsQuerySchema, PERMISSIONS } from '@pharmacy/shared';

import { RequirePermissions } from '../auth/auth.decorators.js';
import { JobsService, type FailedJobsResponse } from './jobs.service.js';

@Controller('operations/jobs')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @Get('failed')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE_SYSTEM)
  listFailed(@Query() query: unknown): Promise<FailedJobsResponse> {
    const parsed = failedJobsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.jobsService.listFailed(parsed.data.limit);
  }
}
