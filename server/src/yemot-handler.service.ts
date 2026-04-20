import { Injectable } from '@nestjs/common';
import { BaseYemotHandlerService } from '@shared/utils/yemot/v2/yemot-router.service';
import { Student } from './db/entities/Student.entity';
import { Transportation } from './db/entities/Transportation.entity';
import { KnownAbsence } from './db/entities/KnownAbsence.entity';
import { StudentKlass } from './db/entities/StudentKlass.entity';
import { Between } from 'typeorm';
/**
 * Yemot Handler Service for processing incoming Yemot calls
 * Currently returns a maintenance mode message
 */

@Injectable()
export class YemotHandlerService extends BaseYemotHandlerService {

  override async processCall(): Promise<void> {
    await this.getUserByDidPhone();
    this.logger.log(`Processing call with ID: ${this.call.callId} from phone: ${this.call.phone}`);
    if (await this.isPastReportingDeadline()) {
      await this.hangupWithMessage("המערכת סגורה. לא ניתן לדווח אחרי השעה תשע וחצי בבוקר. המשך יום טוב.");
      return;
    }
    const student = await this.getStudentByInput()
    if (!student) return;
    const alreadyReported = await this.hasReportedToday(student.id);
    if (alreadyReported) {
      await this.hangupWithMessage("כבר דיווחת היום, לא ניתן לדווח פעמיים.");
      return;
    }
    const transportation = await this.getTransportByInput();
    if (!transportation) return;
    const isValid = await this.isDepartureTimeValid(transportation);
    if (isValid) {
      await this.createAbsenceRecord(student, transportation);
      await this.hangupWithMessage("דווח בהצלחה")
    }
    else {
      await this.hangupWithMessage("יצאת מאוחר מידי המשך יום טוב");
    }
  }
  private isPastReportingDeadline(): boolean {
    const now = new Date();
    const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));

    const hour = israelTime.getHours();
    const minute = israelTime.getMinutes();

    return hour > 9 || (hour === 9 && minute >= 30);
  }
  private async getStudentByInput(): Promise<Student> {
    let student = null;
    while (!student) {
      student = await this.getStudentByTz();

      if (!student) {
        await this.sendMessage('מספר תעודת הזהות לא תקין נסי שוב');
      }
    }
    return student;
  }
  private async getStudentByTz(): Promise<Student> {
    const tz = await this.askForInput('הקישי מספר תעודת זהות');
    const student = await this.dataSource.getRepository(Student).findOneBy({
      userId: this.user.id,
      tz: tz,
    });
    return student;
  }

  private async hasReportedToday(studentId: number): Promise<boolean> {
    const absenceRepo = this.dataSource.getRepository(KnownAbsence);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingReport = await absenceRepo.findOne({
      where: {
        userId: this.user.id,
        studentReferenceId: studentId,
        reportDate: Between(startOfDay, endOfDay)
      }
    });
    return !!existingReport;
  }

  private async getTransportByInput(): Promise<Transportation> {
    let transportation = null;

    while (!transportation) {
      transportation = await this.getTransportByNum();

      if (!transportation) {
        await this.sendMessage(' מספר הסעה לא תקין, נסי שוב');
      }
    }

    return transportation;
  }

  private async getTransportByNum(): Promise<Transportation> {
    const num = await this.askForInput('הקישי מספר הסעה');
    const transportation = await this.dataSource.getRepository(Transportation).findOneBy({
      userId: this.user.id,
      key: Number(num),
    });
    return transportation;
  }

  private async isDepartureTimeValid(transportation): Promise<boolean> {
    let valid: boolean | null = null;
    while (valid === null) {
      const message = `האם יצאת לדרך לפני השעה ${transportation.departureTime}? הקישי 1 - כן, 2 - לא`;
      const userInput = await this.askForInput(message);
      if (userInput === '1') {
        valid = true;
      } else if (userInput === '2') {
        valid = false;
      } else {
        await this.sendMessage('הקשה לא תקינה, נא הקישי 1 או 2');
      }
    }
    return valid;
  }

  private async createAbsenceRecord(student: Student, transportation: Transportation) {
    const absenceRepo = this.dataSource.getRepository(KnownAbsence);
    const studentKlass = await this.dataSource.getRepository(StudentKlass).findOneBy({
      userId: this.user.id,
      studentReferenceId: student.id,
      studentTz: student.tz
    });
    if (!studentKlass) {
      await this.hangupWithMessage(' התלמידה אינה משויכת לכיתה.');
      return;
    }
    const newAbsence = absenceRepo.create({
      userId: this.user.id,
      studentTz: student.tz,
      studentReferenceId: student.id,
      reportDate: new Date(),
      absnceCount: 1,
      isApproved: true,
      comment: `איחור של הסעה  ${transportation.key}`,
      klassReferenceId: studentKlass.klassReferenceId,
    });
    await absenceRepo.save(newAbsence);
  }
}


