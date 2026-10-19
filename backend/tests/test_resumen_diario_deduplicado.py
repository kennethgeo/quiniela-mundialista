import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.services.resumen_deduplicado as resumen
from test_admin_y_sync_seguros import DB


AHORA = datetime(2026, 11, 25, 12, tzinfo=timezone.utc)
MIEMBROS = [{'user_id': 'u', 'league_id': 'liga', 'tournament_id': 7}]


def partido(id=1):
    return {'id': id, 'tournament_id': 7, 'home_team': f'Local {id}', 'away_team': 'Visita',
            'kickoff_at': '2026-11-25T23:00:00Z', 'status': 'pending'}


class EntregasDB(DB):
    """Arbitraje en memoria. Los permisos SQL tienen sus propias pruebas."""
    def __init__(self):
        super().__init__()
        self.tables['notification_deliveries'] = []

    def rpc(self, name, args):
        assert name == 'claim_notification_deliveries'
        self.rpcs.append((name, args))
        claimed = []
        for item in args['p_entregas']:
            key = {k: item[k] for k in ('user_id', 'league_id', 'match_id')}
            key['tipo'] = args['p_tipo']
            row = next((r for r in self.tables['notification_deliveries'] if all(r[k] == v for k, v in key.items())), None)
            if row and row['status'] in ('claimed', 'delivered'):
                continue
            if row is None:
                row = key
                self.tables['notification_deliveries'].append(row)
            row.update(status='claimed', claim_token=item['claim_token'])
            claimed.append({f'claimed_{k}': item[k] for k in ('user_id', 'league_id', 'match_id')})
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=claimed))


def sender(enviados=1):
    return AsyncMock(side_effect=lambda *_a, **_k: {'enviados': enviados, 'por_usuario': {
        'u': {'enviados': enviados, 'fallidos': 0 if enviados else 1},
    }})


def ejecutar(db, enviar, partidos=None):
    return asyncio.run(resumen.enviar_resumen_deduplicado(db, partidos or [partido()], MIEMBROS, [], AHORA, enviar))


def test_repetir_el_resumen_no_envia_de_nuevo_lo_entregado():
    db, enviar = EntregasDB(), sender()
    assert ejecutar(db, enviar)['personas'] == 1
    assert ejecutar(db, enviar)['personas'] == 0
    enviar.assert_awaited_once()
    assert db.tables['notification_deliveries'][0]['status'] == 'delivered'
    assert db.rpcs[0][1]['p_tipo'] == 'resumen-diario:2026-11-25'


def test_el_resumen_nuevo_no_repite_el_anterior_y_no_miente_sobre_pendientes():
    db, enviar = EntregasDB(), sender()
    ejecutar(db, enviar)
    ejecutar(db, enviar, [partido(), partido(2)])
    mensaje = enviar.await_args.args[1]['u']
    assert '1 partido nuevo' in mensaje['title']
    assert 'Te faltan 2' in mensaje['title']
    assert 'Local 2' in mensaje['body'] and 'Local 1' not in mensaje['body']


def test_si_el_push_falla_el_reintento_puede_recuperarlo():
    db = EntregasDB()
    ejecutar(db, sender(enviados=0))
    assert db.tables['notification_deliveries'][0]['status'] == 'failed'
    enviar = sender()
    assert ejecutar(db, enviar)['personas'] == 1
    assert db.tables['notification_deliveries'][0]['status'] == 'delivered'


def test_si_el_envio_lanza_se_libera_el_reclamo_para_reintento():
    db = EntregasDB()
    with pytest.raises(RuntimeError):
        ejecutar(db, AsyncMock(side_effect=RuntimeError('proveedor ficticio')))
    assert db.tables['notification_deliveries'][0]['status'] == 'failed'


def test_sin_bitacora_no_se_envia_nada(monkeypatch):
    db, enviar = EntregasDB(), sender()
    monkeypatch.setattr(db, 'rpc', lambda *_: (_ for _ in ()).throw(RuntimeError('bitácora no disponible')))
    with pytest.raises(RuntimeError):
        ejecutar(db, enviar)
    enviar.assert_not_awaited()
