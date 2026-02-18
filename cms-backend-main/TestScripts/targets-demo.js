const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding targets and simulating actions...');

  // Create employees
  const sales = await prisma.employee.create({
    data: { name: 'Sales Target Demo', phone: '6000001', password: 'x', role: 'sales', isActive: true, accountStatus: 'active', employeeRoles: { create: { role: 'sales', isActive: true, assignedById: 'seed' } } }
  });
  const coord = await prisma.employee.create({
    data: { name: 'Coordinator Target Demo', phone: '6000002', password: 'x', role: 'coordinator', isActive: true, accountStatus: 'active', employeeRoles: { create: { role: 'coordinator', isActive: true, assignedById: 'seed' } } }
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Create targets
  const tNewPatients = await prisma.target.create({
    data: { assignedToId: sales.id, assignedById: sales.id, type: 'monthly', category: 'new_patients', description: 'New patients this month', targetValue: 5, currentValue: 0, startDate: monthStart, endDate: monthEnd, isActive: true }
  });
  const tSpecialties = await prisma.target.create({
    data: { assignedToId: coord.id, assignedById: coord.id, type: 'monthly', category: 'specialties', description: 'Specialties added this month', targetValue: 5, currentValue: 0, startDate: monthStart, endDate: monthEnd, isActive: true }
  });
  const tFollowUp = await prisma.target.create({
    data: { assignedToId: coord.id, assignedById: coord.id, type: 'monthly', category: 'follow_up_patients', description: 'Follow-ups brought back', targetValue: 3, currentValue: 0, startDate: monthStart, endDate: monthEnd, isActive: true }
  });

  console.log('Targets:', { tNewPatients: tNewPatients.id, tSpecialties: tSpecialties.id, tFollowUp: tFollowUp.id });

  console.log('Done. Use the app flows to trigger automatic increments.');
}

main().catch(console.error).finally(() => prisma.$disconnect());


