import { Module } from '@nestjs/common';

import { AdministrationController } from './administration.controller.js';
import { AdministrationService } from './administration.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [AdministrationController, UsersController],
  providers: [AdministrationService, UsersService],
})
export class AdministrationModule {}
