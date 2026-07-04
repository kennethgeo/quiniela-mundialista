-- =============================================================================
-- 16_real_bracket_2026.sql
-- =============================================================================
-- Reemplaza la estructura de eliminatorias por la REAL del Mundial 2026
-- (Anexo de emparejamientos oficial). La estructura anterior estaba inventada:
-- cruces de ganadores/segundos equivocados y slots de tercero de solo 3 grupos.
--
-- Real (por nº de partido):
--   R32: 73 2A-2B · 74 1E-3(A/B/C/D/F) · 75 1F-2C · 76 1C-2F ·
--        77 1I-3(C/D/F/G/H) · 78 2E-2I · 79 1A-3(C/E/F/H/I) · 80 1L-3(E/H/I/J/K) ·
--        81 1D-3(B/E/F/I/J) · 82 1G-3(A/E/H/I/J) · 83 2K-2L · 84 1H-2J ·
--        85 1B-3(E/F/G/I/J) · 86 1J-2H · 87 1K-3(D/E/I/J/L) · 88 2D-2G
--   R16: 89 W74-W77 · 90 W73-W75 · 91 W76-W78 · 92 W79-W80 ·
--        93 W83-W84 · 94 W81-W82 · 95 W86-W88 · 96 W85-W87
--   QF : 97 W89-W90 · 98 W93-W94 · 99 W91-W92 · 100 W95-W96
--   SF : 101 W97-W98 · 102 W99-W100
--   3º : 103 L101-L102   ·   Final: 104 W101-W102
--
-- Solo se actualizan partidos en estado 'pending' (no se pisan los que ya se
-- jugaron/cargaron con equipos reales). Si los IDs no fueran 73-104, no aplica.
-- =============================================================================

-- Ronda de 32
UPDATE public.matches SET home_team='2A', away_team='2B'          WHERE id=73 AND status='pending';
UPDATE public.matches SET home_team='1E', away_team='3A/B/C/D/F'  WHERE id=74 AND status='pending';
UPDATE public.matches SET home_team='1F', away_team='2C'          WHERE id=75 AND status='pending';
UPDATE public.matches SET home_team='1C', away_team='2F'          WHERE id=76 AND status='pending';
UPDATE public.matches SET home_team='1I', away_team='3C/D/F/G/H'  WHERE id=77 AND status='pending';
UPDATE public.matches SET home_team='2E', away_team='2I'          WHERE id=78 AND status='pending';
UPDATE public.matches SET home_team='1A', away_team='3C/E/F/H/I'  WHERE id=79 AND status='pending';
UPDATE public.matches SET home_team='1L', away_team='3E/H/I/J/K'  WHERE id=80 AND status='pending';
UPDATE public.matches SET home_team='1D', away_team='3B/E/F/I/J'  WHERE id=81 AND status='pending';
UPDATE public.matches SET home_team='1G', away_team='3A/E/H/I/J'  WHERE id=82 AND status='pending';
UPDATE public.matches SET home_team='2K', away_team='2L'          WHERE id=83 AND status='pending';
UPDATE public.matches SET home_team='1H', away_team='2J'          WHERE id=84 AND status='pending';
UPDATE public.matches SET home_team='1B', away_team='3E/F/G/I/J'  WHERE id=85 AND status='pending';
UPDATE public.matches SET home_team='1J', away_team='2H'          WHERE id=86 AND status='pending';
UPDATE public.matches SET home_team='1K', away_team='3D/E/I/J/L'  WHERE id=87 AND status='pending';
UPDATE public.matches SET home_team='2D', away_team='2G'          WHERE id=88 AND status='pending';

-- Octavos
UPDATE public.matches SET home_team='W74', away_team='W77' WHERE id=89 AND status='pending';
UPDATE public.matches SET home_team='W73', away_team='W75' WHERE id=90 AND status='pending';
UPDATE public.matches SET home_team='W76', away_team='W78' WHERE id=91 AND status='pending';
UPDATE public.matches SET home_team='W79', away_team='W80' WHERE id=92 AND status='pending';
UPDATE public.matches SET home_team='W83', away_team='W84' WHERE id=93 AND status='pending';
UPDATE public.matches SET home_team='W81', away_team='W82' WHERE id=94 AND status='pending';
UPDATE public.matches SET home_team='W86', away_team='W88' WHERE id=95 AND status='pending';
UPDATE public.matches SET home_team='W85', away_team='W87' WHERE id=96 AND status='pending';

-- Cuartos
UPDATE public.matches SET home_team='W89', away_team='W90'  WHERE id=97  AND status='pending';
UPDATE public.matches SET home_team='W93', away_team='W94'  WHERE id=98  AND status='pending';
UPDATE public.matches SET home_team='W91', away_team='W92'  WHERE id=99  AND status='pending';
UPDATE public.matches SET home_team='W95', away_team='W96'  WHERE id=100 AND status='pending';

-- Semis
UPDATE public.matches SET home_team='W97', away_team='W98'  WHERE id=101 AND status='pending';
UPDATE public.matches SET home_team='W99', away_team='W100' WHERE id=102 AND status='pending';

-- Tercer puesto y Final
UPDATE public.matches SET home_team='L101', away_team='L102' WHERE id=103 AND status='pending';
UPDATE public.matches SET home_team='W101', away_team='W102' WHERE id=104 AND status='pending';

NOTIFY pgrst, 'reload schema';
