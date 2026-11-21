import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import {
  CATALOGO_MODULOS,
  type ChaveModulo,
  ehChaveModulo,
} from './catalogo-modulos';

const CHAVES = CATALOGO_MODULOS.map((modulo) => modulo.chave);

const MENSAGEM_MODULO_DESCONHECIDO = `O módulo deve ser ${CHAVES.slice(0, -1).join(', ')} ou ${CHAVES[CHAVES.length - 1]}.`;

/** Aceita só as chaves exatas do catálogo de módulos; o resto é 400. */
@Injectable()
export class ParseChaveModuloPipe implements PipeTransform<
  string,
  ChaveModulo
> {
  transform(valor: string): ChaveModulo {
    if (!ehChaveModulo(valor)) {
      throw new BadRequestException(MENSAGEM_MODULO_DESCONHECIDO);
    }

    return valor;
  }
}
