import { firestore } from '../../config/firebase';
import { EventData } from '../../types/event.types';

class Event {
  id: string | null;
  name: string;
  date: string;
  picture: string;
  createdAt: string;
  updatedAt: string;

  constructor(data: EventData) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.date = data.date || '';
    this.picture = data.picture || '';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // Convert to plain object for database storage
  toObject(): EventData {
    return {
      id: this.id || undefined,
      name: this.name,
      date: this.date,
      picture: this.picture,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // DATABASE OPERATIONS ONLY - Model Layer Responsibility

  // Create event in Firestore
  static async createEvent(eventData: EventData): Promise<Event> {
    try {
      // Create Event instance
      const event = new Event({
        ...eventData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Save to Firestore and get the document reference
      const docRef = await firestore.collection('events').add(event.toObject());
      event.id = docRef.id;

      // Update the document with the ID
      await docRef.update({ id: docRef.id });

      return event;
    } catch (error: any) {
      console.error('Error creating event:', error);
      throw new Error(`Failed to create event: ${error.message}`);
    }
  }

  // Get event by ID
  static async getEventById(id: string): Promise<Event | null> {
    try {
      const doc = await firestore.collection('events').doc(id).get();
      
      if (!doc.exists) {
        return null;
      }

      return new Event(doc.data() as EventData);
    } catch (error: any) {
      console.error('Error getting event by ID:', error);
      throw new Error(`Failed to get event: ${error.message}`);
    }
  }

  // Get all events with pagination and ordering
  static async getAllEvents(
    limit: number = 50, 
    startAfter?: string,
    orderBy: string = 'date',
    order: 'asc' | 'desc' = 'desc'
  ): Promise<Event[]> {
    try {
      let query = firestore.collection('events')
        .orderBy(orderBy, order)
        .limit(limit);

      if (startAfter) {
        const startAfterDoc = await firestore.collection('events').doc(startAfter).get();
        query = query.startAfter(startAfterDoc);
      }

      const querySnapshot = await query.get();
      return querySnapshot.docs.map((doc: any) => new Event(doc.data() as EventData));
    } catch (error: any) {
      console.error('Error getting all events:', error);
      throw new Error(`Failed to get events: ${error.message}`);
    }
  }

  // Get upcoming events (events with date >= today)
  static async getUpcomingEvents(limit: number = 50): Promise<Event[]> {
    try {
      const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
      
      const querySnapshot = await firestore
        .collection('events')
        .where('date', '>=', today)
        .orderBy('date', 'asc')
        .limit(limit)
        .get();

      return querySnapshot.docs.map(doc => new Event(doc.data() as EventData));
    } catch (error: any) {
      console.error('Error getting upcoming events:', error);
      throw new Error(`Failed to get upcoming events: ${error.message}`);
    }
  }

  // Get past events
  static async getPastEvents(limit: number = 50): Promise<Event[]> {
    try {
      const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
      
      const querySnapshot = await firestore
        .collection('events')
        .where('date', '<', today)
        .orderBy('date', 'desc')
        .limit(limit)
        .get();

      return querySnapshot.docs.map(doc => new Event(doc.data() as EventData));
    } catch (error: any) {
      console.error('Error getting past events:', error);
      throw new Error(`Failed to get past events: ${error.message}`);
    }
  }

  // Update event
  async updateEvent(updateData: Partial<EventData>): Promise<Event> {
    try {
      if (!this.id) {
        throw new Error('Cannot update event without ID');
      }

      const updatedData = {
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      await firestore.collection('events').doc(this.id).update(updatedData);

      // Update local instance
      Object.assign(this, updatedData);

      return this;
    } catch (error: any) {
      console.error('Error updating event:', error);
      throw new Error(`Failed to update event: ${error.message}`);
    }
  }

  // Delete event
  async deleteEvent(): Promise<void> {
    try {
      if (!this.id) {
        throw new Error('Cannot delete event without ID');
      }

      // Delete from Firestore (no need to delete from storage since we're using base64)
      await firestore.collection('events').doc(this.id).delete();
    } catch (error: any) {
      console.error('Error deleting event:', error);
      throw new Error(`Failed to delete event: ${error.message}`);
    }
  }

  // Search events by name
  static async searchEventsByName(searchTerm: string, limit: number = 20): Promise<Event[]> {
    try {
      const querySnapshot = await firestore
        .collection('events')
        .where('name', '>=', searchTerm)
        .where('name', '<=', searchTerm + '\uf8ff')
        .orderBy('name')
        .limit(limit)
        .get();

      return querySnapshot.docs.map(doc => new Event(doc.data() as EventData));
    } catch (error: any) {
      console.error('Error searching events by name:', error);
      throw new Error(`Failed to search events: ${error.message}`);
    }
  }
}

export default Event;
