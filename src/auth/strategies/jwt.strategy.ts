import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requireJwtSecret } from '../../common/auth/require-jwt-secret.util';
import {
  AcessoCondominioService,
  CondominioInativoException,
} from '../../common/tenant/acesso-condominio.service';
import { UsuariosService } from '../../usuarios/usuarios.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usuariosService: UsuariosService,
    private readonly acessoCondominio: AcessoCondominioService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(
        configService.get<string>('JWT_SECRET'),
        'JWT_SECRET',
      ),
    });
  }

  /**
   * Relê o usuário e o condomínio dele numa consulta só, a cada requisição:
   * revogado ou removido continua 401 com a mensagem de sempre; condomínio
   * suspenso ou excluído dá o 401 `CONDOMINIO_INATIVO` na hora, mesmo com
   * token emitido antes (spec `bloqueio-condominio-inativo`, card #192). O
   * `super` nunca é bloqueado. O `JwtAuthGuard` repassa o corpo da exceção.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const usuario = await this.usuariosService.findParaSessao(payload.sub);
    if (!usuario || !usuario.aproved_at) {
      throw new UnauthorizedException(
        'Sessão inválida: acesso revogado ou conta removida.',
      );
    }
    if (this.acessoCondominio.usuarioBloqueado(usuario)) {
      throw new CondominioInativoException();
    }
    return payload;
  }
}
