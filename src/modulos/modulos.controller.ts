import { Controller, Get, UsePipes, ValidationPipe } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EscopoCondominioService } from '../common/tenant/escopo-condominio.service';
import { ModuloDoCondominio, ModulosService } from './modulos.service';

@Controller('modulos')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class ModulosController {
  constructor(
    private readonly modulosService: ModulosService,
    private readonly escopoCondominio: EscopoCondominioService,
  ) {}

  /**
   * Catálogo de módulos com o estado no condomínio de quem chama, resolvido
   * pelo cadastro no banco e não pelo token. Qualquer usuário autenticado:
   * `super` vê todos ativos; quem não tem condomínio, só os sempre ativos.
   */
  @Get()
  async listar(@CurrentUser() user: JwtPayload): Promise<ModuloDoCondominio[]> {
    const escopo = await this.escopoCondominio.resolver(user);

    return this.modulosService.listarParaEscopo(escopo);
  }
}
