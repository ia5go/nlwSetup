import dayjs from 'dayjs';
import { FastifyInstance } from "fastify";
import { z } from 'zod';
import { prisma } from "./prisma";

export async function appRoutes(app: FastifyInstance){
  // criar hábito
  app.post('/habits', async (request) => {
    // precismaos buscar title, weekDays para ciar um novo hábito
    const createHabitBody = z.object({
      title: z.string(),
      weekDays: z.array(z.number().min(0).max(6))
    });
  
    const { title, weekDays } = createHabitBody.parse(request.body);

    const today = dayjs().startOf('day').toDate();

    await prisma.habit.create({
      data:{
        title,
        create_at: today,
        weekDays:{
          create: weekDays.map(weekDay => {
            return{
              week_day: weekDay
            }
          })
        }
      }
    })
  })
  
  // buscar habitos por dia e habitos completos
  app.get('/day', async (request) =>{
    const getDayParams = z.object({
      date: z.coerce.date()
    });

    const { date } = getDayParams.parse(request.query);

    const parsedDate = dayjs(date).startOf('day');
    const weekDay = parsedDate.get('day');

    const possibleHabits = await prisma.habit.findMany({
      where:{
        create_at: {
          lte: date,
        },
        weekDays:{
          some: {
            week_day: weekDay,
          }
        }
      }
    });

    const day = await prisma.day.findUnique({
      where:{
        date: parsedDate.toDate(),
      },
      include:{
        dayHabits: true,
      }
    });

    const completedHabits = day?.dayHabits.map(dayHabit => {
      return dayHabit.habit_id;
    }) ?? [];

    return{
      possibleHabits,
      completedHabits,
    }
  })

  // marcar e desmarcar hábitos
  app.patch('/habits/:id/toggle', async (request) => {
    //:id = route param => parâmetro de identificação

    // utilizando o zod para validar o id, ele já tem como chegar o padrão 'uuid' - caso invalido a execução para aqui msm
    const toggleHabitParams = z.object({
      id: z.string().uuid(),
    });

    const { id } = toggleHabitParams.parse(request.params);
  
    const today = dayjs().startOf('day').toDate();

    //verifica se o dia atual existe no registro de dias
    let day = await prisma.day.findUnique({
      where: {
        date: today,
      }
    });

    // caso o dia não esista cria-se um novo registro
    if(!day){
      day = await prisma.day.create({
        data: {
          date: today,
        }
      });
    }

    // checando se o hábito já está completo naquele dia
    const dayHabit = await prisma.dayHabit.findUnique({
      where:{
        day_id_habit_id:{
          day_id: day.id,
          habit_id: id,
        }
      }
    })

    if(dayHabit){
      //remover a marcação de completo do hábito
      await prisma.dayHabit.delete({
        where:{
          id: dayHabit.id,
        }
      });
    }else{
      // completando o hábito no dia
      await prisma.dayHabit.create({
        data: {
          day_id: day.id,
          habit_id: id,
        }
      });
    }

  })

  //resumo do dia - retorna a lista de dias com os hábitos possíveis e os completados
  app.get('/summary', async (request) => {
    // [ { date: 21/01, amount: 5, completed: 1 }, { date: 22/01, amount: 2,  } ]

    const summary = await prisma.$queryRaw`
      SELECT 
        D.id, 
        D.date,
        (
          SELECT 
            cast(count(*) as float)
          FROM day_habits DH
          WHERE DH.day_id = D.id
        ) as completed,
        (
          SELECT 
            cast(count(*) as float)
          FROM habit_week_days HWD
          JOIN habits H
            ON H.id = HWD.habit_id
          WHERE 
            HWD.week_day = cast(strftime('%W', D.date/1000.0, 'unixepoch') as int)
            AND H.create_at <= D.date
        ) as amount
      FROM days D
    `

    return summary
  })
}
