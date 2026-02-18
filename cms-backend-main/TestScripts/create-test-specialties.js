const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTestSpecialties() {
  try {
    console.log('Creating test specialties...');

    const specialties = [
      {
        name: 'Cardiology',
        nameArabic: 'أمراض القلب',
        category: 'Internal Medicine'
      },
      {
        name: 'Neurology',
        nameArabic: 'أمراض الأعصاب',
        category: 'Internal Medicine'
      },
      {
        name: 'Orthopedics',
        nameArabic: 'العظام',
        category: 'Surgery'
      },
      {
        name: 'Dermatology',
        nameArabic: 'الأمراض الجلدية',
        category: 'Internal Medicine'
      },
      {
        name: 'Pediatrics',
        nameArabic: 'طب الأطفال',
        category: 'Internal Medicine'
      },
      {
        name: 'Gynecology',
        nameArabic: 'أمراض النساء',
        category: 'Surgery'
      },
      {
        name: 'Ophthalmology',
        nameArabic: 'طب العيون',
        category: 'Surgery'
      },
      {
        name: 'ENT',
        nameArabic: 'أنف وأذن وحنجرة',
        category: 'Surgery'
      },
      {
        name: 'Urology',
        nameArabic: 'المسالك البولية',
        category: 'Surgery'
      },
      {
        name: 'Psychiatry',
        nameArabic: 'الطب النفسي',
        category: 'Internal Medicine'
      },
      
      // Medical Services as Specialties
      {
        name: 'Surgery',
        nameArabic: 'الجراحة',
        category: 'Medical Service'
      },
      {
        name: 'Laboratory',
        nameArabic: 'المختبر',
        category: 'Medical Service'
      },
      {
        name: 'X-Ray',
        nameArabic: 'الأشعة',
        category: 'Medical Service'
      },
      {
        name: 'Emergency',
        nameArabic: 'الطوارئ',
        category: 'Medical Service'
      }
    ];

    for (const specialtyData of specialties) {
      try {
        const specialty = await prisma.speciality.create({
          data: specialtyData
        });
        console.log(`✅ Created specialty: ${specialty.name} (ID: ${specialty.id})`);
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`⚠️  Specialty ${specialtyData.name} already exists, skipping...`);
        } else {
          console.error(`❌ Error creating specialty ${specialtyData.name}:`, error.message);
        }
      }
    }

    console.log('\n✅ Test specialties creation completed!');
    
    // Verify specialties were created
    const allSpecialties = await prisma.speciality.findMany({
      where: { isActive: true },
      select: { id: true, name: true, category: true }
    });
    console.log('\nAvailable specialties in database:');
    allSpecialties.forEach(s => console.log(`- ${s.name} (${s.category}) - ID: ${s.id}`));

  } catch (error) {
    console.error('Error creating test specialties:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestSpecialties();
