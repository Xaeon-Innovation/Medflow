const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createFollowUpTestData() {
  try {
    console.log('Creating follow-up test data...');

    // Get or create a hospital
    let hospital = await prisma.hospital.findFirst();
    if (!hospital) {
      console.log('Creating test hospital...');
      hospital = await prisma.hospital.create({
        data: {
          name: 'Test Hospital',
          address: 'Test Address',
          phone: '1234567890'
        }
      });
    }
    console.log(`Using hospital: ${hospital.name} (${hospital.id})`);

    // Get or create a sales person (check through employeeRoles relation)
    let salesPerson = await prisma.employee.findFirst({
      where: {
        employeeRoles: {
          some: {
            role: 'sales',
            isActive: true
          }
        },
        isActive: true
      },
      include: {
        employeeRoles: {
          where: {
            role: 'sales',
            isActive: true
          }
        }
      }
    });
    
    if (!salesPerson) {
      console.log('Creating test sales person...');
      salesPerson = await prisma.employee.create({
        data: {
          name: 'Test Sales Person',
          password: 'sales123',
          phone: '9876543210',
          role: 'sales',
          isActive: true,
          accountStatus: 'active',
          employeeRoles: {
            create: {
              role: 'sales',
              isActive: true,
              assignedById: 'system' // Will need to fix this if it requires a valid ID
            }
          }
        }
      });
    }
    
    // If employee exists but doesn't have the role assignment, create it
    if (salesPerson && (!salesPerson.employeeRoles || salesPerson.employeeRoles.length === 0)) {
      try {
        await prisma.employeeRole.create({
          data: {
            employeeId: salesPerson.id,
            role: 'sales',
            isActive: true,
            assignedById: salesPerson.id
          }
        });
      } catch (err) {
        console.log('Role assignment may already exist, continuing...');
      }
    }
    console.log(`Using sales person: ${salesPerson.name} (${salesPerson.id})`);

    // Get or create specialties
    let specialty1 = await prisma.speciality.findFirst({
      where: { name: 'Cardiology' }
    });
    if (!specialty1) {
      specialty1 = await prisma.speciality.create({
        data: {
          name: 'Cardiology',
          nameArabic: 'أمراض القلب',
          category: 'Medical',
          isActive: true
        }
      });
    }

    let specialty2 = await prisma.speciality.findFirst({
      where: { name: 'Dermatology' }
    });
    if (!specialty2) {
      specialty2 = await prisma.speciality.create({
        data: {
          name: 'Dermatology',
          nameArabic: 'الأمراض الجلدية',
          category: 'Medical',
          isActive: true
        }
      });
    }

    // Get current date
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Create test patients with visits in previous months
    const testPatients = [
      {
        nameEnglish: 'Ahmed Mohamed',
        nameArabic: 'أحمد محمد',
        nationalId: '123456789012',
        phoneNumber: '0501234567',
        salesPersonId: salesPerson.id,
        gender: 'male',
        nationality: 'UAE',
        residencyEmirate: 'Dubai',
        jobTitle: 'Engineer',
        referralSource: 'Test Data'
      },
      {
        nameEnglish: 'Fatima Ali',
        nameArabic: 'فاطمة علي',
        nationalId: '234567890123',
        phoneNumber: '0502345678',
        salesPersonId: salesPerson.id,
        gender: 'female',
        nationality: 'UAE',
        residencyEmirate: 'Abu Dhabi',
        jobTitle: 'Teacher',
        referralSource: 'Test Data'
      },
      {
        nameEnglish: 'Khalid Hassan',
        nameArabic: 'خالد حسن',
        nationalId: '345678901234',
        phoneNumber: '0503456789',
        salesPersonId: salesPerson.id,
        gender: 'male',
        nationality: 'UAE',
        residencyEmirate: 'Sharjah',
        jobTitle: 'Doctor',
        referralSource: 'Test Data'
      },
      {
        nameEnglish: 'Mariam Saleh',
        nameArabic: 'مريم صالح',
        nationalId: '456789012345',
        phoneNumber: '0504567890',
        salesPersonId: salesPerson.id,
        gender: 'female',
        nationality: 'UAE',
        residencyEmirate: 'Ajman',
        jobTitle: 'Nurse',
        referralSource: 'Test Data'
      },
      {
        nameEnglish: 'Omar Ibrahim',
        nameArabic: 'عمر إبراهيم',
        nationalId: '567890123456',
        phoneNumber: '0505678901',
        salesPersonId: salesPerson.id,
        gender: 'male',
        nationality: 'UAE',
        residencyEmirate: 'Ras Al Khaimah',
        jobTitle: 'Manager',
        referralSource: 'Test Data'
      }
    ];

    // Find or create a default doctor for the hospital
    let defaultDoctor = await prisma.doctor.findFirst({
      where: { 
        name: 'Default Doctor',
        hospitalId: hospital.id
      }
    });

    if (!defaultDoctor) {
      console.log('Creating default doctor...');
      defaultDoctor = await prisma.doctor.create({
        data: {
          name: 'Default Doctor',
          hospitalId: hospital.id
        }
      });
    }
    console.log(`Using doctor: ${defaultDoctor.name} (${defaultDoctor.id})`);

    console.log('\nCreating test patients with visits in previous months...');
    
    for (let i = 0; i < testPatients.length; i++) {
      const patientData = testPatients[i];
      
      // Check if patient already exists
      let patient = await prisma.patient.findUnique({
        where: { nationalId: patientData.nationalId }
      });

      if (!patient) {
        patient = await prisma.patient.create({
          data: patientData
        });
        console.log(`Created patient: ${patient.nameEnglish}`);
      } else {
        console.log(`Patient already exists: ${patient.nameEnglish}`);
      }

      // Calculate visit date: i months ago (1, 2, 3, 4, 5 months ago)
      const monthsAgo = i + 1;
      const visitDate = new Date(currentYear, currentMonth - monthsAgo, 15, 10, 0, 0);

      // Check if visit already exists for this patient on this date
      const existingVisit = await prisma.visit.findFirst({
        where: {
          patientId: patient.id,
          hospitalId: hospital.id,
          visitDate: visitDate
        }
      });

      if (!existingVisit) {
        // Create visit (Visit model doesn't have status, only VisitSpeciality does)
        const visit = await prisma.visit.create({
          data: {
            patientId: patient.id,
            hospitalId: hospital.id,
            salesId: salesPerson.id,
            visitDate: visitDate,
            coordinatorId: salesPerson.id,
            visitSpecialities: {
              create: [
                {
                  specialityId: specialty1.id,
                  doctorId: defaultDoctor.id,
                  scheduledTime: visitDate,
                  status: 'completed',
                  details: `Test visit for ${patient.nameEnglish} - ${monthsAgo} months ago`
                },
                ...(i % 2 === 0 ? [{
                  specialityId: specialty2.id,
                  doctorId: defaultDoctor.id,
                  scheduledTime: visitDate,
                  status: 'completed',
                  details: `Additional specialty for ${patient.nameEnglish}`
                }] : [])
              ]
            }
          }
        });
        console.log(`  Created visit for ${patient.nameEnglish} on ${visitDate.toLocaleDateString()} (${monthsAgo} months ago)`);
      } else {
        console.log(`  Visit already exists for ${patient.nameEnglish} on ${visitDate.toLocaleDateString()}`);
      }
    }

    console.log('\n✅ Follow-up test data created successfully!');
    console.log('\nSummary:');
    console.log(`- Hospital: ${hospital.name}`);
    console.log(`- Sales Person: ${salesPerson.name}`);
    console.log(`- ${testPatients.length} test patients created/verified`);
    console.log('- Visits created in previous months (1-5 months ago)');
    console.log('\nThese patients should now appear in the follow-up page!');

  } catch (error) {
    console.error('Error creating follow-up test data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createFollowUpTestData()
  .then(() => {
    console.log('\nScript completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

