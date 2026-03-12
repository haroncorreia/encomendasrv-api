import { BadRequestException, Injectable, ParseUUIDPipe } from '@nestjs/common';

/**
 * Extensão do ParseUUIDPipe com mensagem de erro em português.
 */
@Injectable()
export class ParseUUIDPtPipe extends ParseUUIDPipe {
  constructor() {
    super({
      exceptionFactory: () =>
        new BadRequestException('Informe um UUID válido.'),
    });
  }
}
