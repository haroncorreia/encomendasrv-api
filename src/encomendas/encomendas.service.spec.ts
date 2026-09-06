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

    beforeEach(() => {
      jest.spyOn(service as any, 'findUsuarioAtivo').mockResolvedValue({
        uuid: userPortaria.sub,
        uuid_condominio: 'condo-123',
        uuid_unidade: 'unidade-123',
        perfil: Perfil.PORTARIA,
        aproved_at: new Date(),
      });
    });

    it('deve lançar ForbiddenException se a encomenda foi cadastrada por outro operador', async () => {
      const encomendaOutroOperador = {
        uuid: 'enc-1',
        uuid_condominio: 'condo-123',
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
        uuid_condominio: 'condo-123',
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
        uuid_condominio: 'condo-123',
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
        uuid_condominio: 'condo-123',
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
      uuid_condominio: 'condo-123',
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
      jest.spyOn(service as any, 'findUsuarioAtivo').mockResolvedValue({
        uuid: userAdmin.sub,
        uuid_condominio: 'condo-123',
        uuid_unidade: 'unidade-123',
        perfil: Perfil.ADMIN,
        aproved_at: new Date(),
      });
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
    beforeEach(() => {
      jest.spyOn(service as any, 'findUsuarioAtivo').mockResolvedValue({
        uuid: 'user-admin-123',
        uuid_condominio: 'condo-123',
        uuid_unidade: 'unidade-123',
        perfil: Perfil.ADMIN,
        aproved_at: new Date(),
      });
    });

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
        uuid_condominio: 'condo-123',
        status: EncomendaStatus.RETIRADA,
        justificativa_baixa_administrativa:
          'Recebido diretamente pela administração',
        baixa_administrativa_em: new Date('2026-01-15T10:00:00.000Z'),
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      await service.update(
        'enc-baixa-1',
        { descricao: 'Correção de texto' },
        userAdmin,
      );

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
        uuid_condominio: 'condo-123',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      const dto = { restricao_retirada: null } as unknown as UpdateEncomendaDto;
      await service.update('enc-1', dto, userAdmin);

      const payload = updateMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(
        EncomendaRestricaoRetirada.UNIDADE,
      );
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
        uuid_condominio: 'condo-123',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as any);

      const updateMock = jest.fn().mockResolvedValue(1);
      const whereMock = jest.fn().mockReturnValue({ update: updateMock });
      mockKnex.mockReturnValue({ where: whereMock });

      await service.update(
        'enc-1',
        { descricao: 'Correção de texto' },
        userAdmin,
      );

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
      jest
        .spyOn(service as any, 'findUsuarioAtivo')
        .mockResolvedValue(actorMorador);
      jest
        .spyOn(service, 'findActiveByUuid')
        .mockResolvedValue({ uuid: 'nova-enc' } as any);
    });

    it('deve salvar restricao_retirada=unidade quando o campo não é informado na criação (card #9)', async () => {
      const insertMock = mockInsert();
      const dto = { palavra_chave: 'Chave123' } as CreateEncomendaDto;

      await service.create(dto, userMorador);

      const payload = insertMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(
        EncomendaRestricaoRetirada.UNIDADE,
      );
    });

    it('deve preservar restricao_retirada=pessoal quando informado explicitamente na criação', async () => {
      const insertMock = mockInsert();
      const dto = {
        palavra_chave: 'Chave123',
        restricao_retirada: EncomendaRestricaoRetirada.PESSOAL,
      } as CreateEncomendaDto;

      await service.create(dto, userMorador);

      const payload = insertMock.mock.calls[0][0];
      expect(payload.restricao_retirada).toBe(
        EncomendaRestricaoRetirada.PESSOAL,
      );
    });
  });

  describe('findAll e findByFilters (Dual-mode Pagination & Busca)', () => {
    const userAdmin = {
      sub: 'admin-1',
      email: 'admin@condominio.com',
      perfil: Perfil.ADMIN,
      uuid_condominio: 'condo-123',
    } as any;

    it('deve retornar Array cru quando chamado sem parâmetro de paginação (cliente legado)', async () => {
      const mockEncomendas = [{ uuid: 'enc-1', status: 'recebida' }] as any[];
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findAll(userAdmin, {});

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(mockEncomendas);
    });

    it('deve retornar envelope PaginatedResult quando chamado com paginate=true', async () => {
      const mockEncomendas = [{ uuid: 'enc-1', status: 'recebida' }] as any[];
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        clone: jest.fn().mockReturnValue({
          clearSelect: jest.fn().mockReturnThis(),
          clearOrder: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ count: 42 }),
          }),
        }),
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findAll(userAdmin, {
        paginate: true,
        page: 2,
        limit: 10,
      });

      expect(Array.isArray(result)).toBe(false);
      expect(result).toEqual({
        data: mockEncomendas,
        total: 42,
        page: 2,
        limit: 10,
        totalPages: 5,
      });
    });

    it('deve retornar envelope PaginatedResult no findByFilters com busca', async () => {
      const mockEncomendas = [
        { uuid: 'enc-2', status: 'aguardando retirada' },
      ] as any[];
      const andWhereMock = jest.fn();
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        andWhere: andWhereMock,
        clone: jest.fn().mockReturnValue({
          clearSelect: jest.fn().mockReturnThis(),
          clearOrder: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ count: 1 }),
          }),
        }),
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findByFilters(
        {
          paginate: true,
          busca: '12345',
          page: 1,
          limit: 15,
        },
        userAdmin,
      );

      expect(result).toEqual({
        data: mockEncomendas,
        total: 1,
        page: 1,
        limit: 15,
        totalPages: 1,
      });
      expect(andWhereMock).toHaveBeenCalled();
    });

    it('deve aplicar filtro de status no findAll quando informado', async () => {
      const mockEncomendas = [
        { uuid: 'enc-prevista', status: EncomendaStatus.PREVISTA },
      ] as any[];
      const andWhereMock = jest.fn();
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        andWhere: andWhereMock,
        clone: jest.fn().mockReturnValue({
          clearSelect: jest.fn().mockReturnThis(),
          clearOrder: jest.fn().mockReturnThis(),
          count: jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ count: 1 }),
          }),
        }),
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findAll(userAdmin, {
        paginate: true,
        status: EncomendaStatus.PREVISTA,
        page: 1,
        limit: 10,
      });

      expect(result).toEqual({
        data: mockEncomendas,
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(andWhereMock).toHaveBeenCalledWith(
        'status',
        EncomendaStatus.PREVISTA,
      );
    });

    it('deve retornar Array cru no findByFilters quando cliente legado não envia parâmetros de paginação', async () => {
      const mockEncomendas = [
        { uuid: 'enc-filtro-legado', status: EncomendaStatus.PREVISTA },
      ] as any[];
      const andWhereMock = jest.fn();
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        andWhere: andWhereMock,
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findByFilters(
        {
          status: EncomendaStatus.PREVISTA,
        },
        userAdmin,
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(mockEncomendas);
      expect(andWhereMock).toHaveBeenCalledWith(
        'status',
        EncomendaStatus.PREVISTA,
      );
    });

    it('deve retornar Array cru no findAll quando cliente legado envia apenas status sem paginação', async () => {
      const mockEncomendas = [
        { uuid: 'enc-legado-status', status: EncomendaStatus.RECEBIDA },
      ] as any[];
      const andWhereMock = jest.fn();
      const queryMock: any = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockEncomendas),
        andWhere: andWhereMock,
      };

      jest
        .spyOn(service as any, 'scopedListQuery')
        .mockResolvedValue({ query: queryMock });
      jest
        .spyOn(service as any, 'enrichWithRelacionamentos')
        .mockResolvedValue(mockEncomendas);

      const result = await service.findAll(userAdmin, {
        status: EncomendaStatus.RECEBIDA,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(mockEncomendas);
      expect(andWhereMock).toHaveBeenCalledWith(
        'status',
        EncomendaStatus.RECEBIDA,
      );
    });
  });
});
