import { Module } from '@nestjs/common';

import { PosController } from './pos.controller.js';
import { PosService } from './pos.service.js';

@Module({ controllers: [PosController], providers: [PosService] })
export class PosModule {}
