import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requireJwtSecret } from '../../common/auth/require-jwt-secret.util';
import { UsuariosService } from '../../usuarios/usuarios.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usuariosService: UsuariosService,
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

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const usuario = await this.usuariosService.findByIdInterno(payload.sub);
    if (!usuario || !usuario.aproved_at) {
      throw new UnauthorizedException(
        'Sessão inválida: acesso revogado ou conta removida.',
      );
    }
    return payload;
  }
}
