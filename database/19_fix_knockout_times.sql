-- =============================================================================
-- 19_fix_knockout_times.sql
-- =============================================================================
-- Corrige los horarios (kickoff_at) de octavos en adelante (partidos 89-104).
-- La estructura de bracket (migración 16) arregló los cruces pero NO tocó los
-- horarios, que habían quedado con un patrón inventado (17:00/21:00 UTC todos
-- los días). Aquí se ponen los horarios REALES del calendario oficial FIFA 2026.
--
-- Fuente: calendario oficial FIFA 2026, verificado con dos fuentes independientes
-- que coinciden al 100% (times en ET y en UK/BST). Todas las horas de EE.UU. en
-- julio son EDT (UTC-4). Los nº de partido del DB == nº oficiales FIFA (confirmado
-- porque los alimentadores de cuartos del DB —97=W89-W90, 98=W93-W94...— calzan
-- exactamente con el bracket oficial).
--
-- Referencia (nº · ET · UTC · Costa Rica UTC-6):
--   OCTAVOS
--   89 · sáb 4 jul 17:00 ET · 21:00 UTC · 15:00 CR
--   90 · sáb 4 jul 13:00 ET · 17:00 UTC · 11:00 CR
--   91 · dom 5 jul 16:00 ET · 20:00 UTC · 14:00 CR
--   92 · dom 5 jul 20:00 ET · 00:00 UTC (lun 6) · 18:00 CR (dom 5)
--   93 · lun 6 jul 15:00 ET · 19:00 UTC · 13:00 CR
--   94 · lun 6 jul 20:00 ET · 00:00 UTC (mar 7) · 18:00 CR (lun 6)
--   95 · mar 7 jul 12:00 ET · 16:00 UTC · 10:00 CR
--   96 · mar 7 jul 16:00 ET · 20:00 UTC · 14:00 CR
--   CUARTOS
--   97 · jue 9 jul 16:00 ET · 20:00 UTC · 14:00 CR
--   98 · vie 10 jul 15:00 ET · 19:00 UTC · 13:00 CR
--   99 · sáb 11 jul 17:00 ET · 21:00 UTC · 15:00 CR
--  100 · sáb 11 jul 21:00 ET · 01:00 UTC (dom 12) · 19:00 CR (sáb 11)
--   SEMIS
--  101 · mar 14 jul 15:00 ET · 19:00 UTC · 13:00 CR
--  102 · mié 15 jul 15:00 ET · 19:00 UTC · 13:00 CR
--   TERCER PUESTO
--  103 · sáb 18 jul 17:00 ET · 21:00 UTC · 15:00 CR
--   FINAL
--  104 · dom 19 jul 15:00 ET · 19:00 UTC · 13:00 CR
-- =============================================================================

-- Octavos de final
UPDATE public.matches SET kickoff_at = '2026-07-04T21:00:00Z' WHERE id = 89;
UPDATE public.matches SET kickoff_at = '2026-07-04T17:00:00Z' WHERE id = 90;
UPDATE public.matches SET kickoff_at = '2026-07-05T20:00:00Z' WHERE id = 91;
UPDATE public.matches SET kickoff_at = '2026-07-06T00:00:00Z' WHERE id = 92;
UPDATE public.matches SET kickoff_at = '2026-07-06T19:00:00Z' WHERE id = 93;
UPDATE public.matches SET kickoff_at = '2026-07-07T00:00:00Z' WHERE id = 94;
UPDATE public.matches SET kickoff_at = '2026-07-07T16:00:00Z' WHERE id = 95;
UPDATE public.matches SET kickoff_at = '2026-07-07T20:00:00Z' WHERE id = 96;

-- Cuartos de final
UPDATE public.matches SET kickoff_at = '2026-07-09T20:00:00Z' WHERE id = 97;
UPDATE public.matches SET kickoff_at = '2026-07-10T19:00:00Z' WHERE id = 98;
UPDATE public.matches SET kickoff_at = '2026-07-11T21:00:00Z' WHERE id = 99;
UPDATE public.matches SET kickoff_at = '2026-07-12T01:00:00Z' WHERE id = 100;

-- Semifinales
UPDATE public.matches SET kickoff_at = '2026-07-14T19:00:00Z' WHERE id = 101;
UPDATE public.matches SET kickoff_at = '2026-07-15T19:00:00Z' WHERE id = 102;

-- Tercer puesto
UPDATE public.matches SET kickoff_at = '2026-07-18T21:00:00Z' WHERE id = 103;

-- Final
UPDATE public.matches SET kickoff_at = '2026-07-19T19:00:00Z' WHERE id = 104;

NOTIFY pgrst, 'reload schema';
