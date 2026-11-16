import type { LocalizedText } from './languages.js';
import type { PermissionLevel, Side } from './permissions.js';

export interface DefaultRole {
  key: string;
  side: Side;
  names: LocalizedText;
  calculated: boolean;
  defaultPermission: PermissionLevel;
}

/** Project roles created on first start. Admins can rename, extend and deactivate them later. */
export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: 'ss_pl',
    side: 'slimstock',
    names: { de: 'Projektleiter', en: 'Project Lead', nl: 'Projectleider', es: 'Jefe de proyecto' },
    calculated: true,
    defaultPermission: 'pl_slimstock',
  },
  {
    key: 'ss_sa',
    side: 'slimstock',
    names: { de: 'Solution Architect', en: 'Solution Architect', nl: 'Solution Architect', es: 'Arquitecto de soluciones' },
    calculated: true,
    defaultPermission: 'team_slimstock',
  },
  {
    key: 'ss_tc',
    side: 'slimstock',
    names: { de: 'Technical Consultant', en: 'Technical Consultant', nl: 'Technisch consultant', es: 'Consultor técnico' },
    calculated: true,
    defaultPermission: 'team_slimstock',
  },
  {
    key: 'ss_c',
    side: 'slimstock',
    names: { de: 'Consultant', en: 'Consultant', nl: 'Consultant', es: 'Consultor' },
    calculated: true,
    defaultPermission: 'team_slimstock',
  },
  {
    key: 'ss_tr',
    side: 'slimstock',
    names: { de: 'Trainer', en: 'Trainer', nl: 'Trainer', es: 'Formador' },
    calculated: true,
    defaultPermission: 'team_slimstock',
  },
  {
    key: 'ss_sp',
    side: 'slimstock',
    names: { de: 'Sponsor', en: 'Sponsor', nl: 'Sponsor', es: 'Patrocinador' },
    calculated: false,
    defaultPermission: 'team_slimstock',
  },
  {
    key: 'cu_pl',
    side: 'customer',
    names: { de: 'Projektleiter', en: 'Project Lead', nl: 'Projectleider', es: 'Jefe de proyecto' },
    calculated: true,
    defaultPermission: 'pl_customer',
  },
  {
    key: 'cu_pm',
    side: 'customer',
    names: { de: 'Projektmanager', en: 'Project Manager', nl: 'Projectmanager', es: 'Gestor de proyecto' },
    calculated: true,
    defaultPermission: 'pl_customer',
  },
  {
    key: 'cu_ku',
    side: 'customer',
    names: { de: 'Key User', en: 'Key User', nl: 'Key user', es: 'Usuario clave' },
    calculated: true,
    defaultPermission: 'team_customer',
  },
  {
    key: 'cu_u',
    side: 'customer',
    names: { de: 'User', en: 'User', nl: 'Gebruiker', es: 'Usuario' },
    calculated: true,
    defaultPermission: 'reader',
  },
  {
    key: 'cu_infra',
    side: 'customer',
    names: { de: 'IT-Infrastructure', en: 'IT Infrastructure', nl: 'IT-infrastructuur', es: 'Infraestructura TI' },
    calculated: true,
    defaultPermission: 'team_customer',
  },
  {
    key: 'cu_if',
    side: 'customer',
    names: { de: 'IT-Interface', en: 'IT Interface', nl: 'IT-interface', es: 'Interfaz TI' },
    calculated: true,
    defaultPermission: 'team_customer',
  },
  {
    key: 'cu_ifp',
    side: 'customer',
    names: { de: 'IT-Interface-Partner', en: 'IT Interface Partner', nl: 'IT-interfacepartner', es: 'Socio de interfaz TI' },
    calculated: true,
    defaultPermission: 'team_customer',
  },
  {
    key: 'cu_sp',
    side: 'customer',
    names: { de: 'Sponsor', en: 'Sponsor', nl: 'Sponsor', es: 'Patrocinador' },
    calculated: false,
    defaultPermission: 'pl_customer',
  },
];
