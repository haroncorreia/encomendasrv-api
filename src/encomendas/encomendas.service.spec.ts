import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { EncomendasService } from './encomendas.service';
import { EncomendaStatus } from './enums/encomenda-status.enum';
import { Perfil } from '../usuarios/enums/perfil.enum';
import { BaixaAdministrativaEncomendaDto } from './dto/baixa-administrativa-encomenda.dto';
import { CreateEncomendaDto } from './dto/create-encomenda.dto';
import { UpdateEncomendaDto } from './dto/update-encomenda.dto';
import { EncomendaRestricaoRetirada } from './enums/encomenda-restricao-retirada.enum';

describe('EncomendasService - Regras de exclusão para Portaria', () => {
  let service: EncomendasService;
  let mockKnex: any;

  beforeEach(() => {
    mockKnex = jest.fn();
    service = new EncomendasService(mockKnex);
  });

  describe('remove (perfil PORTARIA)', () => {
    const userPortaria = {
      sub: 'user-portaria-123',
      email: 'portaria@condominio.com',
      perfil: Perfil.PORTARIA,
      uuid_condominio: 'condo-123',
    } as any;

    it('deve lançar ForbiddenException se a encomenda foi cadastrada por outro operador', async () => {
      const encomendaOutroOperador = {
        uuid: 'enc-1',
        recebido_por_uuid_usuario: 'outro-operador-999',
        created_by: 'outro@condominio.com',
        status: EncomendaStatus.AGUARDANDO_RETIRADA,
        justificativa_baixa_administrativa: null,
      } as any;

      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaOutroOperador);

      await expect(service.remove('enc-1', userPortaria)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deve lançar BadRequestException se a encomenda já foi retirada por morador', async () => {
      const encomendaRetirada = {
        uuid: 'enc-2',
        recebido_por_uuid_usuario: userPortaria.sub,
        created_by: userPortaria.email,
        status: EncomendaStatus.RETIRADA,
        entregue_em: new Date(),
        justificativa_baixa_administrativa: null,
      } as any;

      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaRetirada);

      await expect(service.remove('enc-2', userPortaria)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar BadRequestException se a encomenda sofreu baixa administrativa', async () => {
      const encomendaBaixaAdmin = {
        uuid: 'enc-3',
        recebido_por_uuid_usuario: userPortaria.sub,
        created_by: userPortaria.email,
        status: EncomendaStatus.RETIRADA,
        justificativa_baixa_administrativa: 'Devolução ao remetente',
      } as any;

      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaBaixaAdmin);

      await expect(service.remove('enc-3', userPortaria)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve permitir a exclusão de encomenda cadastrada pelo próprio operador, pendente e sem baixa admin', async () => {
      const encomendaElegivel = {
        uuid: 'enc-4',
        recebido_por_uuid_usuario: userPortaria.sub,
        created_by: userPortaria.email,
        status: EncomendaStatus.AGUARDANDO_RETIRADA,
        entregue_em: null,
        justificativa_baixa_administrativa: null,
      } as any;

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaElegivel);

      await service.remove('enc-4', userPortaria);

      expect(whereMock).toHaveBeenCalledWith({ uuid: 'enc-4' });
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted_by: userPortaria.email,
        }),
      );
    });
  });

  describe('baixaAdministrativa', () => {
    const userAdmin = {
      sub: 'user-admin-123',
      email: 'admin@condominio.com',
      perfil: Perfil.ADMIN,
      uuid_condominio: 'condo-123',
    } as any;

    const encomendaAguardandoRetirada = {
      uuid: 'enc-baixa-1',
      uuid_usuario: 'morador-1',
      status: EncomendaStatus.AGUARDANDO_RETIRADA,
      justificativa_baixa_administrativa: null,
    } as any;

    const mockUpdate = () => {
      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });
      return updateMock;
    };

    beforeEach(() => {
      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue(encomendaAguardandoRetirada);
    });

    it('deve gravar entregue_em com a data retroativa informada e baixa_administrativa_em com o instante do registro, quando status é retirada', async () => {
      const updateMock = mockUpdate();
      const entregueEmRetroativo = '2026-01-15T10:00:00.000Z';
      const antes = new Date();

      const dto: BaixaAdministrativaEncomendaDto = {
        status: EncomendaStatus.RETIRADA,
        justificativa: 'Recebido diretamente pela administração',
        entregue_em: entregueEmRetroativo,
      };

      await service.baixaAdministrativa('enc-baixa-1', dto, userAdmin);

      const depois = new Date();
      const payload = updateMock.mock.calls[0][0];

      expect(payload.entregue_em).toEqual(new Date(entregueEmRetroativo));
      expect(payload.baixa_administrativa_em).toBeInstanceOf(Date);
      expect(payload.baixa_administrativa_em.getTime()).toBeGreaterThanOrEqual(
        antes.getTime(),
      );
      expect(payload.baixa_administrativa_em.getTime()).toBeLessThanOrEqual(
        depois.getTime(),
      );
    });

    it('deve lançar BadRequestException quando status é retirada e entregue_em não é informado', async () => {
      mockUpdate();
      const dto = {
        status: EncomendaStatus.RETIRADA,
        justificativa: 'Recebido diretamente pela administração',
      } as BaixaAdministrativaEncomendaDto;

      await expect(
        service.baixaAdministrativa('enc-baixa-1', dto, userAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando status é retirada e entregue_em está no futuro', async () => {
      mockUpdate();
      const umAnoNoFuturo = new Date();
      umAnoNoFuturo.setFullYear(umAnoNoFuturo.getFullYear() + 1);

      const dto: BaixaAdministrativaEncomendaDto = {
        status: EncomendaStatus.RETIRADA,
        justificativa: 'Recebido diretamente pela administração',
        entregue_em: umAnoNoFuturo.toISOString(),
      };

      await expect(
        service.baixaAdministrativa('enc-baixa-1', dto, userAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando status é cancelada e entregue_em é informado', async () => {
      mockUpdate();
      const dto: BaixaAdministrativaEncomendaDto = {
        status: EncomendaStatus.CANCELADA,
        justificativa: 'Encomenda extraviada',
        entregue_em: '2026-01-15T10:00:00.000Z',
      };

      await expect(
        service.baixaAdministrativa('enc-baixa-1', dto, userAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve aceitar normalmente quando status é cancelada e entregue_em não é informado', async () => {
      const updateMock = mockUpdate();
      const dto: BaixaAdministrativaEncomendaDto = {
        status: EncomendaStatus.CANCELADA,
        justificativa: 'Encomenda extraviada',
      };

      await service.baixaAdministrativa('enc-baixa-1', dto, userAdmin);

      const payload = updateMock.mock.calls[0][0];
      expect(payload.entregue_em).toBeUndefined();
      expect(payload.baixa_administrativa_em).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    it('não deve incluir baixa_administrativa_em no payload ao editar campos livres da encomenda', async () => {
      const userAdmin = {
        sub: 'user-admin-123',
        email: 'admin@condominio.com',
        perfil: Perfil.ADMIN,
        uuid_condominio: 'condo-123',
      } as any;

      jest.spyOn(service, 'findActiveByUuid').mockResolvedValue({
        uuid: 'enc-baixa-1',
        uuid_usuario: 'morador-1',
        status: EncomendaStatus.RETIRADA,
        justificativa_baixa_administrativa: 'Recebido diretamente pela administração',
        baixa_administrativa_em: new Date('2026-01-15T10:00:00.000Z'),
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      await service.update('enc-baixa-1', { descricao: 'Correção de texto' }, userAdmin);

      const payload = updateMock.mock.calls[0][0];
      expect(payload).not.toHaveProperty('baixa_administrativa_em');
    });

    it('deve salvar restricao_retirada=unidade quando PATCH envia o campo como null (card #9)', async () => {
      const userAdmin = {
        sub: 'user-admin-123',
        email: 'admin@condominio.com',
        perfil: Perfil.ADMIN,
        uuid_condominio: 'condo-123',
      } as any;

      jest.spyOn(service, 'findActiveByUuid').mockResolvedValue({
        uuid: 'enc-1',
        uuid_usuario: 'morador-1',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      const dto = { restricao_retirada: null } as unknown as UpdateEncomendaDto;
      await service.update('enc-1', dto, userAdmin);

      const payload = updateMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(EncomendaRestricaoRetirada.UNIDADE);
    });

    it('não deve incluir restricao_retirada no payload quando o campo não é informado no PATCH', async () => {
      const userAdmin = {
        sub: 'user-admin-123',
        email: 'admin@condominio.com',
        perfil: Perfil.ADMIN,
        uuid_condominio: 'condo-123',
      } as any;

      jest.spyOn(service, 'findActiveByUuid').mockResolvedValue({
        uuid: 'enc-1',
        uuid_usuario: 'morador-1',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      await service.update('enc-1', { descricao: 'Correção de texto' }, userAdmin);

      const payload = updateMock.mock.calls[0][0];
      expect(payload).not.toHaveProperty('restricao_retirada');
    });
  });

  describe('create', () => {
    const userMorador = {
      sub: 'morador-1',
      email: 'morador@condominio.com',
      perfil: Perfil.MORADOR,
      uuid_condominio: 'condo-123',
    } as any;

    const actorMorador = {
      uuid: 'morador-1',
      uuid_condominio: 'condo-123',
      uuid_unidade: 'unidade-1',
      perfil: Perfil.MORADOR,
    };

    const mockInsert = () => {
      const insertMock = jest.fn().mockResolvedValue(undefined);
      mockKnex.mockReturnValue({ insert: insertMock });
      return insertMock;
    };

    beforeEach(() => {
      jest.spyOn(service as any, 'findUsuarioAtivo').mockResolvedValue(actorMorador);
      jest.spyOn(service, 'findActiveByUuid').mockResolvedValue({ uuid: 'nova-enc' } as any);
    });

    it('deve salvar restricao_retirada=unidade quando o campo não é informado na criação (card #9)', async () => {
      const insertMock = mockInsert();
      const dto = { palavra_chave: 'Chave123' } as CreateEncomendaDto;

      await service.create(dto, userMorador);

      const payload = insertMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(EncomendaRestricaoRetirada.UNIDADE);
    });

    it('deve preservar restricao_retirada=pessoal quando informado explicitamente na criação', async () => {
      const insertMock = mockInsert();
      const dto = {
        palavra_chave: 'Chave123',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as CreateEncomendaDto;

      await service.create(dto, userMorador);

      const payload = insertMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(EncomendaRestricaoRetirada.PESSOAL);
    });
  });
});
