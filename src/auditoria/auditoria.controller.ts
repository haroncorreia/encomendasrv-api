import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { PaginationAuditoriaDto } from './dto/pagination-auditoria.dto';
import { AuditoriaService } from './auditoria.service';

@Controller('auditoria')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
@Roles(Perfil.SUPER, Perfil.ADMIN)
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get()
  findAll(@Query() pagination: PaginationAuditoriaDto) {
    return this.auditoriaService.findAllPaginated(pagination);
  }
}
