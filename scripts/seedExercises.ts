import { firestore } from '../config/firebase';
import { ExerciseData } from '../types/exercise.types';
import standardExercises from '../data/standardExercises.json';

/**
 * Seed Script - Populate Exercise Library with Standard Exercises
 * Uses predefined IDs from standardExercises.json to ensure consistency
 * between frontend static data and backend database.
 * 
 * Run with: npx ts-node scripts/seedExercises.ts
 */

async function seedExercises() {
  try {
    console.log('🌱 Starting exercise seeding...');
    console.log(`📋 ${standardExercises.length} exercises to seed`);

    let successCount = 0;
    let errorCount = 0;

    for (const exercise of standardExercises) {
      try {
        const exerciseData = {
          name: exercise.name,
          category: exercise.category,
          trackingType: exercise.trackingType,
          description: exercise.description,
          muscleGroups: exercise.muscleGroups,
          isStandard: true,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Use predefined ID from JSON file
        await firestore.collection('exercises').doc(exercise.id).set(exerciseData);
        successCount++;
        console.log(`✅ Added: ${exercise.name} (ID: ${exercise.id})`);
      } catch (error) {
        errorCount++;
        console.error(`❌ Failed to add ${exercise.name}:`, error);
      }
    }

    console.log('\n=== Seeding Complete ===');
    console.log(`✅ Successfully added: ${successCount} exercises`);
    console.log(`❌ Failed: ${errorCount} exercises`);
    console.log(`📊 Total: ${standardExercises.length} exercises`);

    // Summary by category
    const categories = standardExercises.reduce((acc, ex) => {
      acc[ex.category] = (acc[ex.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\n📊 Breakdown by category:');
    Object.entries(categories).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

// Run the seed function
seedExercises()
  .then(() => {
    console.log('\n🎉 Seeding completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Seeding failed:', error);
    process.exit(1);
  });
