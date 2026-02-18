import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDoctorNames() {
  // Find all doctors with invalid names
  // Note: If name field is not nullable, we only check for empty string and 'z'
  const doctors = await prisma.doctor.findMany({
    where: {
      OR: [
        { name: '' },
        { name: 'z' },
        { name: 'Z' }
      ]
    },
    include: {
      hospital: {
        select: { id: true, name: true }
      }
    },
    orderBy: {
      hospital: { name: 'asc' }
    }
  });

  console.log(`Found ${doctors.length} doctors with invalid names:`);
  
  // Check each doctor for appointments and visits
  for (const doctor of doctors) {
    const [visitCount, appointmentCount] = await Promise.all([
      prisma.visitSpeciality.count({
        where: { doctorId: doctor.id }
      }),
      prisma.appointmentSpeciality.count({
        where: { doctorId: doctor.id }
      })
    ]);
    
    const hasRecords = visitCount > 0 || appointmentCount > 0;
    const status = hasRecords 
      ? `⚠️ HAS ${visitCount} visit(s) and ${appointmentCount} appointment(s) - CANNOT DELETE` 
      : `✓ No records - CAN DELETE`;
    
    console.log(`- ID: ${doctor.id}, Name: "${doctor.name}", Hospital: ${doctor.hospital?.name || 'Unknown'} (${doctor.hospital?.id || 'N/A'}) - ${status}`);
  }

  // Specifically check Sulaiman hospital
  const sulaimanDoctors = doctors.filter(d => 
    d.hospital?.name?.toLowerCase().includes('sulaiman') || 
    d.hospital?.name?.toLowerCase().includes('suliman')
  );
  
  if (sulaimanDoctors.length > 0) {
    console.log(`\nSulaiman hospital has ${sulaimanDoctors.length} doctors with invalid names:`);
    for (const doctor of sulaimanDoctors) {
      const [visitCount, appointmentCount] = await Promise.all([
        prisma.visitSpeciality.count({
          where: { doctorId: doctor.id }
        }),
        prisma.appointmentSpeciality.count({
          where: { doctorId: doctor.id }
        })
      ]);
      
      const hasRecords = visitCount > 0 || appointmentCount > 0;
      const status = hasRecords 
        ? `⚠️ HAS ${visitCount} visit(s) and ${appointmentCount} appointment(s) - CANNOT DELETE` 
        : `✓ No records - CAN DELETE`;
      
      console.log(`- ID: ${doctor.id}, Name: "${doctor.name}" - ${status}`);
    }
  }

  return doctors;
}

checkDoctorNames()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });

