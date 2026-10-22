import { Module } from '@nestjs/common';

import { AdministrationController } from './administration.controller.js';
import { AdministrationService } from './administration.service.js';
import { CatalogImportService } from './catalog-import.service.js';
import { ShopSettingsController } from './shop-settings.controller.js';
import { ShopSettingsService } from './shop-settings.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [AdministrationController, ShopSettingsController, UsersController],
  providers: [AdministrationService, CatalogImportService, ShopSettingsService, UsersService],
})
export class AdministrationModule {}
