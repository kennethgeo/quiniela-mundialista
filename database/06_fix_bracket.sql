-- Actualización de cruces de la fase eliminatoria (Mundial 2026)
-- Asigna los equipos correctos (Ej: 1A, 2B, W73, L101) a las llaves para que el sistema pueda conectarlas.

-- Ronda de 32 (Matches 73-88)
UPDATE public.matches SET home_team = '1A', away_team = '3B/C/D' WHERE id = 73;
UPDATE public.matches SET home_team = '2E', away_team = '2F' WHERE id = 74;
UPDATE public.matches SET home_team = '1I', away_team = '3A/J/K' WHERE id = 75;
UPDATE public.matches SET home_team = '2G', away_team = '2H' WHERE id = 76;
UPDATE public.matches SET home_team = '1C', away_team = '3D/E/F' WHERE id = 77;
UPDATE public.matches SET home_team = '2A', away_team = '2B' WHERE id = 78;
UPDATE public.matches SET home_team = '1K', away_team = '3H/I/L' WHERE id = 79;
UPDATE public.matches SET home_team = '2I', away_team = '2J' WHERE id = 80;
UPDATE public.matches SET home_team = '1E', away_team = '3F/G/H' WHERE id = 81;
UPDATE public.matches SET home_team = '2C', away_team = '2D' WHERE id = 82;
UPDATE public.matches SET home_team = '1G', away_team = '3A/B/L' WHERE id = 83;
UPDATE public.matches SET home_team = '2K', away_team = '2L' WHERE id = 84;
UPDATE public.matches SET home_team = '1D', away_team = '3E/F/G' WHERE id = 85;
UPDATE public.matches SET home_team = '1B', away_team = '3C/D/A' WHERE id = 86;
UPDATE public.matches SET home_team = '1L', away_team = '3I/J/K' WHERE id = 87;
UPDATE public.matches SET home_team = '1H', away_team = '3G/H/I' WHERE id = 88;

-- Octavos de Final (Matches 89-96)
UPDATE public.matches SET home_team = 'W73', away_team = 'W74' WHERE id = 89;
UPDATE public.matches SET home_team = 'W75', away_team = 'W76' WHERE id = 90;
UPDATE public.matches SET home_team = 'W77', away_team = 'W78' WHERE id = 91;
UPDATE public.matches SET home_team = 'W79', away_team = 'W80' WHERE id = 92;
UPDATE public.matches SET home_team = 'W81', away_team = 'W82' WHERE id = 93;
UPDATE public.matches SET home_team = 'W83', away_team = 'W84' WHERE id = 94;
UPDATE public.matches SET home_team = 'W85', away_team = 'W86' WHERE id = 95;
UPDATE public.matches SET home_team = 'W87', away_team = 'W88' WHERE id = 96;

-- Cuartos de Final (Matches 97-100)
UPDATE public.matches SET home_team = 'W89', away_team = 'W90' WHERE id = 97;
UPDATE public.matches SET home_team = 'W91', away_team = 'W92' WHERE id = 98;
UPDATE public.matches SET home_team = 'W93', away_team = 'W94' WHERE id = 99;
UPDATE public.matches SET home_team = 'W95', away_team = 'W96' WHERE id = 100;

-- Semifinales (Matches 101-102)
UPDATE public.matches SET home_team = 'W97', away_team = 'W98' WHERE id = 101;
UPDATE public.matches SET home_team = 'W99', away_team = 'W100' WHERE id = 102;

-- Tercer Puesto (Match 103)
UPDATE public.matches SET home_team = 'L101', away_team = 'L102' WHERE id = 103;

-- Final (Match 104)
UPDATE public.matches SET home_team = 'W101', away_team = 'W102' WHERE id = 104;
