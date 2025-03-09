#include <stdio.h>
#include <conio.h>

int main(){
    int total, days, month[31], dailybudget, average ;

    printf("Enter the number of the days in the month (max 31) : ");
    scanf("%d", &days);
    printf("Enter your daily expenses for %d Days: ", days);

    for(int i = 0; i<days; i++){
        printf("/n Day %d :", i+1);
        scanf("%d", & month[i]);
    }

    printf("Enter your dai;y budget limit : ");
    scanf("%d", dailybudget);

    return 0;
}