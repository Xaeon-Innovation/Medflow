const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function ensureDataEntry(name) {
  const emp = await prisma.employee.create({
    data: {
      name,
      phone: Math.floor(Math.random() * 1e10).toString(),
      password: 'test123',
      role: 'data_entry',
      isActive: true,
      accountStatus: 'active',
      employeeRoles: {
        create: { role: 'data_entry', isActive: true, assignedById: 'seed' }
      }
    }
  });
  return emp;
}

async function main() {
  console.log('Seeding data-entry assignment demo...');

  // Create two data entry users
  const [de1, de2] = await Promise.all([
    ensureDataEntry('Data Entry A'),
    ensureDataEntry('Data Entry B'),
  ]);

  // Create a sales user for patient creation
  const sales = await prisma.employee.create({
    data: {
      name: 'Sales For Demo',
      phone: '5550001',
      password: 'test123',
      role: 'sales',
      isActive: true,
      accountStatus: 'active',
      employeeRoles: { create: { role: 'sales', isActive: true, assignedById: 'seed' } }
    }
  });

  // Create patients with missing fields to trigger tasks
  const patients = [];
  for (let i = 0; i < 5; i++) {
    const p = await prisma.patient.create({
      data: {
        nameEnglish: `Demo Patient ${i + 1}`,
        phoneNumber: i % 2 === 0 ? null : `05000${i}`,
        salesPersonId: sales.id,
      }
    });
    patients.push(p);
  }

  console.log('Created patients:', patients.map(p => p.nameEnglish));

  // Show open DataEntryTask counts per data entry
  const open = await prisma.dataEntryTask.groupBy({
    by: ['dataEntryId'],
    where: { status: 'pending' },
    _count: { _all: true }
  });
  console.log('Open DataEntryTasks per assignee:', open);
}

main().catch(console.error).finally(() => prisma.$disconnect());


