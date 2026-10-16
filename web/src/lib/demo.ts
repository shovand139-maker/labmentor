/**
 * The demo organizations and people. The seed script writes them to the database, and the sign-in page
 * lists them when DEMO_SIGN_IN is true. Ids are fixed so tests and links stay stable.
 */

export type Role = "learner" | "instructor";

export type DemoTenant = { id: string; slug: string; name: string };

export type DemoUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
};

export const DEMO_TENANTS: readonly DemoTenant[] = [
  {
    id: "6f1c8a52-3b7d-4e0a-9c11-2d5e8f4a7b01",
    slug: "contoso",
    name: "Contoso Learning",
  },
  {
    id: "9a2e4c71-5d8b-4f3e-8a20-7b6c1d9e3f02",
    slug: "fabrikam",
    name: "Fabrikam Academy",
  },
];

const [contoso, fabrikam] = DEMO_TENANTS as [DemoTenant, DemoTenant];

export const DEMO_USERS: readonly DemoUser[] = [
  {
    id: "1b6d2f0a-8c4e-4a7b-9f21-3e5c7a9b1d01",
    tenantId: contoso.id,
    name: "Asha Rao",
    email: "asha.rao@contoso.example",
    role: "learner",
  },
  {
    id: "2c7e3a1b-9d5f-4b8c-8a32-4f6d8b0c2e02",
    tenantId: contoso.id,
    name: "Ben Ortiz",
    email: "ben.ortiz@contoso.example",
    role: "learner",
  },
  {
    id: "3d8f4b2c-0e6a-4c9d-9b43-5a7e9c1d3f03",
    tenantId: contoso.id,
    name: "Priya Nair",
    email: "priya.nair@contoso.example",
    role: "instructor",
  },
  {
    id: "4e9a5c3d-1f7b-4dae-8c54-6b8f0d2e4a04",
    tenantId: fabrikam.id,
    name: "Diego Alvarez",
    email: "diego.alvarez@fabrikam.example",
    role: "learner",
  },
  {
    id: "5fab6d4e-2a8c-4ebf-9d65-7c9a1e3f5b05",
    tenantId: fabrikam.id,
    name: "Mei Chen",
    email: "mei.chen@fabrikam.example",
    role: "instructor",
  },
];

export function demoTenant(id: string): DemoTenant | undefined {
  return DEMO_TENANTS.find((t) => t.id === id);
}
